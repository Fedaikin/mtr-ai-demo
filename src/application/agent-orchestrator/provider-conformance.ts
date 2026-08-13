import { z } from "zod";

import type { GroundedAgentOutput } from "@/domain/models";
import { redactSensitiveData } from "@/lib/redaction";
import type {
  GroundedAgentInput,
  LlmProviderMetadata,
  LlmProviderRequestOptions,
  LLMProvider,
} from "@/ports";

const citationSchema = z.object({
  sourceSystem: z.enum([
    "APPIUS",
    "SAP",
    "CATALOG",
    "NORMATIVE",
    "SCENARIO",
    "REPORT",
    "RAG",
    "LLM",
    "PROCESS_ENGINE",
    "TELEMETRY",
    "METRIC_REGISTRY",
    "TASK_STORE",
    "RISK_ENGINE",
  ]),
  entityId: z.string().min(1).max(500),
  versionOrSnapshot: z.string().min(1).max(500),
  clauseId: z.string().max(500).nullable(),
});

const outputSchema = z.object({
  answer: z.string().min(1).max(20_000),
  facts: z.array(z.string().max(4_000)).max(100),
  recommendations: z.array(z.string().max(4_000)).max(100),
  citations: z.array(citationSchema).max(200),
  confidence: z.number().min(0).max(1),
  requiresHumanReview: z.boolean(),
  toolCalls: z.array(
    z.object({
      tool: z.string().min(1).max(200),
      outcome: z.enum(["OK", "ERROR"]),
      durationMs: z.number().nonnegative(),
    }),
  ).max(200),
}).strict();

export interface LlmProviderConformancePolicy {
  provider: string;
  model: string;
  version: string;
  timeoutMs: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxRequestCostUsd: number;
  requestsPerMinute: number;
  trainingAllowed: false;
  retentionAllowed: false;
  enabled: () => boolean;
  estimateRequestCostUsd?: (inputTokens: number, maxOutputTokens: number) => number;
  now?: () => number;
}

export class LlmProviderBoundaryError extends Error {
  constructor(
    readonly code: string,
    safeMessage: string,
  ) {
    super(safeMessage);
    this.name = "LlmProviderBoundaryError";
  }
}

interface RateWindow {
  startedAt: number;
  count: number;
}

/**
 * Provider-neutral safety boundary. It persists neither prompts nor reasoning,
 * and exposes only safe error codes to the application fallback.
 */
export class ConformingLlmProvider implements LLMProvider {
  readonly metadata: LlmProviderMetadata;
  private readonly rateWindows = new Map<string, RateWindow>();

  constructor(
    private readonly delegate: LLMProvider,
    private readonly policy: LlmProviderConformancePolicy,
  ) {
    if (policy.trainingAllowed || policy.retentionAllowed) {
      throw new LlmProviderBoundaryError(
        "LLM_PROVIDER_POLICY_UNSAFE",
        "Политика LLM-провайдера не разрешена для контура МТР.",
      );
    }
    this.metadata = {
      provider: boundedLabel(policy.provider),
      model: boundedLabel(policy.model),
      version: boundedLabel(policy.version),
      trainingAllowed: false,
      retentionAllowed: false,
      reasoningPersistence: "NONE",
      maxInputTokens: positiveInteger(policy.maxInputTokens),
      maxOutputTokens: positiveInteger(policy.maxOutputTokens),
      maxRequestCostUsd: nonnegativeNumber(policy.maxRequestCostUsd),
    };
  }

  async respond(
    input: GroundedAgentInput,
    options: LlmProviderRequestOptions = {},
  ): Promise<GroundedAgentOutput> {
    if (!this.policy.enabled()) {
      throw boundaryError("LLM_PROVIDER_DISABLED");
    }
    if (options.signal?.aborted) {
      throw boundaryError("LLM_PROVIDER_CANCELLED");
    }

    this.consumeRateLimit(input.userId);
    const sanitized = sanitizeProviderInput(input);
    const inputTokens = estimateTokens(sanitized);
    if (inputTokens > this.metadata.maxInputTokens) {
      throw boundaryError("LLM_INPUT_BUDGET_EXCEEDED");
    }
    const estimatedCost = this.policy.estimateRequestCostUsd?.(
      inputTokens,
      this.metadata.maxOutputTokens,
    ) ?? 0;
    if (!Number.isFinite(estimatedCost) || estimatedCost > this.metadata.maxRequestCostUsd) {
      throw boundaryError("LLM_COST_BUDGET_EXCEEDED");
    }

    const controller = new AbortController();
    const forwardAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", forwardAbort, { once: true });
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(boundaryError("LLM_PROVIDER_TIMEOUT"));
        }, positiveInteger(this.policy.timeoutMs));
      });
      const raw = await Promise.race([
        this.delegate.respond(sanitized, { signal: controller.signal }),
        timeout,
      ]);
      const parsed = outputSchema.safeParse(raw);
      if (!parsed.success) throw boundaryError("LLM_OUTPUT_INVALID");
      if (estimateTokens(parsed.data) > this.metadata.maxOutputTokens) {
        throw boundaryError("LLM_OUTPUT_BUDGET_EXCEEDED");
      }
      return parsed.data as GroundedAgentOutput;
    } catch (error) {
      if (timedOut) throw boundaryError("LLM_PROVIDER_TIMEOUT");
      if (options.signal?.aborted) throw boundaryError("LLM_PROVIDER_CANCELLED");
      if (error instanceof LlmProviderBoundaryError) throw error;
      throw normalizeDelegateError(error);
    } finally {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", forwardAbort);
    }
  }

  private consumeRateLimit(subjectId: string): void {
    const limit = positiveInteger(this.policy.requestsPerMinute);
    const now = this.policy.now?.() ?? Date.now();
    const current = this.rateWindows.get(subjectId);
    if (!current || now - current.startedAt >= 60_000) {
      this.rateWindows.set(subjectId, { startedAt: now, count: 1 });
      return;
    }
    if (current.count >= limit) throw boundaryError("LLM_PROVIDER_RATE_LIMITED");
    current.count += 1;
  }
}

export function createOfflineProviderConformance(delegate: LLMProvider): ConformingLlmProvider {
  return new ConformingLlmProvider(delegate, {
    provider: "OFFLINE_DETERMINISTIC",
    model: "mtr-grounded-demo",
    version: "1.0.0",
    timeoutMs: 15_000,
    maxInputTokens: 50_000,
    maxOutputTokens: 50_000,
    maxRequestCostUsd: 0,
    requestsPerMinute: 120,
    trainingAllowed: false,
    retentionAllowed: false,
    enabled: () => process.env.MTR_AGENT_LLM_ENABLED !== "false",
    estimateRequestCostUsd: () => 0,
  });
}

function sanitizeProviderInput(input: GroundedAgentInput): GroundedAgentInput {
  return {
    userId: safeString(input.userId, 200),
    message: safeString(input.message, 20_000),
    ...(input.threadId ? { threadId: safeString(input.threadId, 200) } : {}),
    facts: input.facts.slice(0, 500).map((fact) => ({
      source: safeString(fact.source, 200),
      payload: redactSensitiveData(fact.payload, {
        maxDepth: 12,
        maxArrayItems: 1_000,
        maxStringLength: 20_000,
      }),
    })),
  };
}

function safeString(value: string, maxLength: number): string {
  const redacted = redactSensitiveData(value, { maxStringLength: maxLength });
  return typeof redacted === "string" ? redacted : "[СКРЫТО]";
}

function estimateTokens(value: unknown): number {
  const serialized = JSON.stringify(value) ?? "";
  return Math.max(1, Math.ceil(serialized.length / 4));
}

function positiveInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new LlmProviderBoundaryError(
      "LLM_PROVIDER_POLICY_INVALID",
      "Политика LLM-провайдера настроена некорректно.",
    );
  }
  return Math.trunc(value);
}

function nonnegativeNumber(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new LlmProviderBoundaryError(
      "LLM_PROVIDER_POLICY_INVALID",
      "Политика LLM-провайдера настроена некорректно.",
    );
  }
  return value;
}

function boundedLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 120) {
    throw new LlmProviderBoundaryError(
      "LLM_PROVIDER_POLICY_INVALID",
      "Политика LLM-провайдера настроена некорректно.",
    );
  }
  return normalized;
}

function boundaryError(code: string): LlmProviderBoundaryError {
  const messages: Record<string, string> = {
    LLM_PROVIDER_DISABLED: "LLM-провайдер отключён оператором.",
    LLM_PROVIDER_CANCELLED: "Формирование ответа отменено.",
    LLM_PROVIDER_RATE_LIMITED: "Превышен безопасный лимит запросов к LLM-провайдеру.",
    LLM_INPUT_BUDGET_EXCEEDED: "Входной контекст превышает безопасный лимит LLM-провайдера.",
    LLM_OUTPUT_BUDGET_EXCEEDED: "Ответ превышает безопасный лимит LLM-провайдера.",
    LLM_COST_BUDGET_EXCEEDED: "Запрос превышает разрешённый бюджет LLM-провайдера.",
    LLM_PROVIDER_TIMEOUT: "LLM-провайдер не ответил в установленный срок.",
    LLM_OUTPUT_INVALID: "Ответ LLM-провайдера не прошёл проверку контракта.",
    LLM_PROVIDER_UNAVAILABLE: "LLM-провайдер временно недоступен.",
  };
  return new LlmProviderBoundaryError(
    code,
    messages[code] ?? "LLM-провайдер временно недоступен.",
  );
}

function normalizeDelegateError(error: unknown): LlmProviderBoundaryError {
  const code = typeof error === "object" && error !== null
    ? String((error as Record<string, unknown>).code ?? "").toLocaleUpperCase("en-US")
    : "";
  if (code.includes("RATE")) return boundaryError("LLM_PROVIDER_RATE_LIMITED");
  if (code.includes("MALFORMED") || code.includes("VALIDATION") || code.includes("PARSE")) {
    return boundaryError("LLM_OUTPUT_INVALID");
  }
  if (code.includes("CANCEL")) return boundaryError("LLM_PROVIDER_CANCELLED");
  return boundaryError("LLM_PROVIDER_UNAVAILABLE");
}

import "server-only";

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { VERSION as OPENAI_SDK_VERSION } from "openai/version";
import { z } from "zod";

import type { AgentExecutionContext } from "@/domain/agent/context";
import { redactSensitiveData } from "@/lib/redaction";

import {
  UNIVERSAL_READ_CAPABILITY_SCHEMAS,
  type UniversalReadCapabilityKey,
} from "./capability-registry";

const CAPABILITY_KEYS = Object.freeze(
  Object.keys(UNIVERSAL_READ_CAPABILITY_SCHEMAS) as UniversalReadCapabilityKey[],
);

const resolvedEntitySchema = z.object({
  kind: z.enum(["BUSINESS_PROJECT", "SPECIFICATION", "MATERIAL", "POSITION"]),
  code: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(300),
}).strict();

const plannerDecisionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("CALL_CAPABILITIES"),
    calls: z.array(z.object({
      capabilityKey: z.enum(CAPABILITY_KEYS as [UniversalReadCapabilityKey, ...UniversalReadCapabilityKey[]]),
      argumentsJson: z.string().trim().min(2).max(20_000),
    }).strict()).min(1).max(12),
  }).strict(),
  z.object({
    kind: z.literal("ASK_CLARIFICATION"),
    question: z.string().trim().min(1).max(500),
    candidates: z.array(resolvedEntitySchema).max(8),
  }).strict(),
  z.object({
    kind: z.literal("PROPOSE_ACTION"),
    action: z.object({
      actionType: z.enum(["CREATE_EXPERT_TASK", "PURCHASE_REQUEST_DRAFT", "OPEN_DETAILS"]),
      objectCode: z.string().trim().min(1).max(200),
      reason: z.string().trim().min(1).max(1_000),
    }).strict(),
  }).strict(),
  z.object({
    kind: z.literal("ANSWER_FROM_RESULTS"),
    response: z.object({
      summary: z.string().trim().min(1).max(2_000),
    }).strict(),
  }).strict(),
]);
const plannerEnvelopeSchema = z.object({ decision: plannerDecisionSchema }).strict();

const proseSchema = z.object({
  summary: z.string().trim().min(1).max(2_000),
  riskExplanations: z.array(z.object({
    id: z.string().trim().min(1).max(300),
    explanation: z.string().trim().min(1).max(1_500),
  }).strict()).max(30),
  recommendationExplanations: z.array(z.object({
    id: z.string().trim().min(1).max(300),
    explanation: z.string().trim().min(1).max(1_500),
  }).strict()).max(30),
}).strict();

export type UniversalPlannerDecision = z.output<typeof plannerDecisionSchema>;
export type UniversalVerifiedProse = z.output<typeof proseSchema>;

export interface OpenAIResponsesPlannerConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly providerVersion: string;
  readonly promptVersion: string;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  readonly maxRetries: number;
}

interface ResponsesStream<T> {
  finalResponse(): Promise<Readonly<{
    id: string;
    model: string;
    output_parsed: T | null;
    usage?: Readonly<{
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
    }>;
  }>>;
}

export interface OpenAIResponsesClientLike {
  responses: {
    stream<T>(body: Record<string, unknown>, options?: Readonly<{ signal?: AbortSignal }>): ResponsesStream<T>;
  };
  models: {
    list(): Promise<{ data: Array<{ id: string }> }>;
  };
}

export interface UniversalPlannerTrace {
  readonly provider: "OPENAI";
  readonly model: string;
  readonly providerVersion: string;
  readonly promptVersion: string;
  readonly responseId: string;
  readonly durationMs: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
}

export class OpenAIResponsesPlanner {
  private readonly client: OpenAIResponsesClientLike;

  constructor(
    readonly config: OpenAIResponsesPlannerConfig,
    client?: OpenAIResponsesClientLike,
  ) {
    if (!config.apiKey.trim() || !config.model.trim()) {
      throw new OpenAIResponsesPlannerError("OPENAI_PROVIDER_NOT_CONFIGURED");
    }
    this.client = client ?? new OpenAI({
      apiKey: config.apiKey,
      maxRetries: 0,
      timeout: config.timeoutMs,
    }) as unknown as OpenAIResponsesClientLike;
  }

  async listAvailableModels(): Promise<readonly string[]> {
    const page = await this.client.models.list();
    return Object.freeze(page.data.map((model) => model.id).sort((left, right) => left.localeCompare(right, "en")));
  }

  async plan(
    message: string,
    context: AgentExecutionContext,
    systemPrompt: string,
  ): Promise<Readonly<{ decision: UniversalPlannerDecision; trace: UniversalPlannerTrace }>> {
    const planned = await this.request({
      schema: plannerEnvelopeSchema,
      schemaName: "mtr_universal_planner_decision",
      instructions: systemPrompt,
      input: JSON.stringify({
        message: safeText(message, 20_000),
        accessScopeActive: Boolean(context.trusted.activeProjectId),
        availableCapabilities: CAPABILITY_KEYS,
        constraints: {
          maxCapabilityCalls: 12,
          maxPlanningRounds: 4,
          maxParallelReads: 3,
          identityArgumentsForbidden: true,
        },
      }),
    });
    return Object.freeze({ decision: planned.decision.decision, trace: planned.trace });
  }

  async compose(
    deterministicAnswer: unknown,
    capabilityResults: readonly unknown[],
    context: AgentExecutionContext,
    systemPrompt: string,
  ): Promise<Readonly<{ decision: UniversalVerifiedProse; trace: UniversalPlannerTrace }>> {
    return this.request({
      schema: proseSchema,
      schemaName: "mtr_verified_answer_prose",
      instructions: `${systemPrompt}\n\nПереформулируй только текстовые explanation. Не меняй числа, проценты, verdict, IDs, citations или action availability.`,
      input: JSON.stringify(redactSensitiveData({
        deterministicAnswer,
        capabilityResults: capabilityResults.map(boundedProviderResult),
        accessScopeActive: Boolean(context.trusted.activeProjectId),
      }, { maxDepth: 10, maxArrayItems: 100, maxStringLength: 5_000 })),
    });
  }

  private async request<T>(input: Readonly<{
    schema: z.ZodType<T>;
    schemaName: string;
    instructions: string;
    input: string;
  }>): Promise<Readonly<{ decision: T; trace: UniversalPlannerTrace }>> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      const startedAt = performance.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const stream = this.client.responses.stream<T>({
          model: this.config.model,
          instructions: input.instructions,
          input: input.input,
          store: false,
          max_output_tokens: this.config.maxOutputTokens,
          text: {
            format: zodTextFormat(input.schema, input.schemaName),
            verbosity: "low",
          },
          metadata: {
            component: "mtr-universal-chat",
            prompt_version: this.config.promptVersion,
          },
        }, { signal: controller.signal });
        const response = await stream.finalResponse();
        if (!response.output_parsed) throw new OpenAIResponsesPlannerError("OPENAI_STRUCTURED_OUTPUT_INVALID");
        return Object.freeze({
          decision: response.output_parsed,
          trace: Object.freeze({
            provider: "OPENAI" as const,
            model: response.model || this.config.model,
            providerVersion: this.config.providerVersion,
            promptVersion: this.config.promptVersion,
            responseId: response.id,
            durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
            inputTokens: response.usage?.input_tokens ?? null,
            outputTokens: response.usage?.output_tokens ?? null,
            totalTokens: response.usage?.total_tokens ?? null,
          }),
        });
      } catch (error) {
        lastError = error;
        if (attempt >= this.config.maxRetries || !transient(error)) break;
      } finally {
        clearTimeout(timer);
      }
    }
    throw normalizeProviderError(lastError);
  }
}

export function readOpenAIResponsesPlannerConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): OpenAIResponsesPlannerConfig | null {
  const apiKey = environment.OPENAI_API_KEY?.trim() ?? "";
  const model = environment.OPENAI_MODEL?.trim() ?? "";
  if (!apiKey || !model) return null;
  return {
    apiKey,
    model,
    providerVersion: `openai-node-${OPENAI_SDK_VERSION}`,
    promptVersion: "4.0.0",
    timeoutMs: boundedInteger(environment.MTR_AGENT_LLM_TIMEOUT_MS, 1_000, 60_000, 15_000),
    maxOutputTokens: boundedInteger(environment.MTR_AGENT_LLM_MAX_OUTPUT_TOKENS, 256, 20_000, 4_000),
    maxRetries: boundedInteger(environment.MTR_AGENT_LLM_MAX_RETRIES, 0, 2, 1),
  };
}

export class OpenAIResponsesPlannerError extends Error {
  constructor(readonly code: string) {
    super("Live LLM временно недоступна; используется проверенный резервный ответ.");
    this.name = "OpenAIResponsesPlannerError";
  }
}

export function parsePlannerCapabilityInput(call: Readonly<{
  capabilityKey: UniversalReadCapabilityKey;
  argumentsJson: string;
}>): unknown {
  let value: unknown;
  try {
    value = JSON.parse(call.argumentsJson);
  } catch {
    throw new OpenAIResponsesPlannerError("OPENAI_CAPABILITY_ARGUMENTS_INVALID");
  }
  return UNIVERSAL_READ_CAPABILITY_SCHEMAS[call.capabilityKey].parse(value);
}

function safeText(value: string, maxLength: number): string {
  const redacted = redactSensitiveData(value, { maxDepth: 4, maxArrayItems: 20, maxStringLength: maxLength });
  return typeof redacted === "string" ? redacted : "[СКРЫТО]";
}

function boundedProviderResult(value: unknown): unknown {
  return redactSensitiveData(value, {
    maxDepth: 8,
    maxArrayItems: 50,
    maxStringLength: 2_000,
  });
}

function transient(error: unknown): boolean {
  if (error instanceof OpenAIResponsesPlannerError) return false;
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : 0;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function normalizeProviderError(error: unknown): OpenAIResponsesPlannerError {
  if (error instanceof OpenAIResponsesPlannerError) return error;
  if (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError") {
    return new OpenAIResponsesPlannerError("OPENAI_PROVIDER_TIMEOUT");
  }
  return new OpenAIResponsesPlannerError("OPENAI_PROVIDER_UNAVAILABLE");
}

function boundedInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

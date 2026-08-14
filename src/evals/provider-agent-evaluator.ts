import { readFile } from "node:fs/promises";

import type { GroundedAgentOutput } from "@/domain/models";
import {
  ConformingLlmProvider,
  type LlmProviderConformancePolicy,
} from "@/application/agent-orchestrator/provider-conformance";
import type { GroundedAgentInput, LLMProvider } from "@/ports";
import { z } from "zod";

export const EXPECTED_PROVIDER_AGENT_EVAL_CASES = 20;

const profileSchema = z.enum([
  "VALID",
  "SECRET_ASSIGNMENT",
  "SECRET_BEARER",
  "SECRET_FACT_KEY",
  "SECRET_NESTED_CREDENTIAL",
  "DISABLED",
  "INPUT_BUDGET",
  "OUTPUT_BUDGET",
  "COST_BUDGET",
  "RATE_LIMIT",
  "SUBJECT_ISOLATION",
  "WINDOW_RESET",
  "TIMEOUT",
  "PRE_CANCELLED",
  "INVALID_CONFIDENCE",
  "EMPTY_ANSWER",
  "INVALID_CITATION",
  "INVALID_TOOL_OUTCOME",
  "RAW_PROVIDER_ERROR",
  "UNSAFE_DATA_POLICY",
]);

const providerEvalCaseSchema = z.object({
  id: z.string().min(1),
  split: z.enum(["validation", "held-out", "adversarial"]),
  category: z.string().min(1),
  maturity: z.enum(["I0", "A1"]),
  runtimeBoundary: z.literal("LLM_PROVIDER"),
  datasetVersion: z.literal("provider-conformance-1.0.0"),
  input: z.object({ profile: profileSchema }).strict(),
  expected: z.object({
    errorCode: z.string().min(1).optional(),
    delegateCalls: z.number().int().nonnegative(),
    redacted: z.boolean().default(false),
    metadataValid: z.boolean().default(false),
    maxDurationMs: z.number().positive().max(10_000),
  }).strict(),
}).strict();

export type ProviderAgentEvalCase = z.output<typeof providerEvalCaseSchema>;

export interface ProviderAgentEvalRunResult {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly cases: readonly {
    readonly id: string;
    readonly split: ProviderAgentEvalCase["split"];
    readonly category: string;
    readonly passed: boolean;
    readonly durationMs: number;
    readonly failures: readonly string[];
  }[];
}

export async function loadProviderAgentEvalCases(filePath: string): Promise<ProviderAgentEvalCase[]> {
  const lines = (await readFile(filePath, "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const cases = lines.map((line, index) => {
    try {
      return providerEvalCaseSchema.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(`Некорректный provider JSONL eval в строке ${index + 1}`, { cause: error });
    }
  });
  if (cases.length !== EXPECTED_PROVIDER_AGENT_EVAL_CASES) {
    throw new Error(
      `Ожидалось ${EXPECTED_PROVIDER_AGENT_EVAL_CASES} provider eval-кейсов, получено ${cases.length}.`,
    );
  }
  if (new Set(cases.map((item) => item.id)).size !== cases.length) {
    throw new Error("Идентификаторы provider eval-кейсов должны быть уникальными.");
  }
  const counts = countBy(cases, (item) => item.split);
  if (counts.validation !== 4 || counts["held-out"] !== 4 || counts.adversarial !== 12) {
    throw new Error("Provider eval должен содержать 4 validation, 4 held-out и 12 adversarial кейсов.");
  }
  return cases;
}

export async function runProviderAgentEvals(
  cases: readonly ProviderAgentEvalCase[],
): Promise<ProviderAgentEvalRunResult> {
  const results: ProviderAgentEvalRunResult["cases"][number][] = [];
  for (const evalCase of cases) results.push(await runCase(evalCase));
  const passed = results.filter((item) => item.passed).length;
  return { total: results.length, passed, failed: results.length - passed, cases: results };
}

async function runCase(
  evalCase: ProviderAgentEvalCase,
): Promise<ProviderAgentEvalRunResult["cases"][number]> {
  const failures: string[] = [];
  const started = performance.now();
  const profile = evalCase.input.profile;
  const captured: GroundedAgentInput[] = [];
  let delegateCalls = 0;
  let now = Date.parse("2026-08-13T10:00:00.000Z");
  const delegate: LLMProvider = {
    respond: async (value, options) => {
      delegateCalls += 1;
      captured.push(value);
      if (profile === "TIMEOUT") {
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("raw timeout")), { once: true });
        });
      }
      if (profile === "RAW_PROVIDER_ERROR") throw new Error("credential=must-not-leak");
      return outputFor(profile);
    },
  };

  let actualError: string | null = null;
  let provider: ConformingLlmProvider | null = null;
  try {
    const unsafe = profile === "UNSAFE_DATA_POLICY";
    const configuration = {
      ...policyFor(profile, () => now),
      ...(unsafe ? { trainingAllowed: true } : {}),
    } as unknown as LlmProviderConformancePolicy;
    provider = new ConformingLlmProvider(delegate, configuration);
    const controller = new AbortController();
    if (profile === "PRE_CANCELLED") controller.abort();
    await provider.respond(inputFor(profile), { signal: controller.signal });
    if (profile === "RATE_LIMIT") await provider.respond(inputFor(profile));
    if (profile === "SUBJECT_ISOLATION") {
      await provider.respond({ ...inputFor(profile), userId: "demo-user-002" });
    }
    if (profile === "WINDOW_RESET") {
      now += 60_001;
      await provider.respond(inputFor(profile));
    }
  } catch (error) {
    actualError = errorCode(error);
  }

  if ((evalCase.expected.errorCode ?? null) !== actualError) {
    failures.push(`Ожидалась ошибка ${evalCase.expected.errorCode ?? "none"}, получена ${actualError ?? "none"}.`);
  }
  if (delegateCalls !== evalCase.expected.delegateCalls) {
    failures.push(`Ожидалось вызовов delegate: ${evalCase.expected.delegateCalls}, получено ${delegateCalls}.`);
  }
  if (evalCase.expected.redacted) {
    const serialized = JSON.stringify(captured);
    if (!serialized.includes("[СКРЫТО]")) failures.push("Redaction marker не дошёл до provider boundary.");
    if (/secret-value|abcdefghijklmnop|must-not-survive/iu.test(serialized)) {
      failures.push("Provider получил исходный секрет.");
    }
  }
  if (evalCase.expected.metadataValid) {
    if (
      provider?.metadata.provider !== "OFFLINE_EVAL" ||
      provider.metadata.model !== "mtr-eval-model" ||
      provider.metadata.version !== "1.0.0" ||
      provider.metadata.trainingAllowed !== false ||
      provider.metadata.retentionAllowed !== false ||
      provider.metadata.reasoningPersistence !== "NONE"
    ) {
      failures.push("Provider metadata не закрепляет безопасную политику.");
    }
  }
  const durationMs = performance.now() - started;
  if (durationMs > evalCase.expected.maxDurationMs) {
    failures.push(`Время ${durationMs.toFixed(2)}ms превышает ${evalCase.expected.maxDurationMs}ms.`);
  }
  return {
    id: evalCase.id,
    split: evalCase.split,
    category: evalCase.category,
    passed: failures.length === 0,
    durationMs,
    failures,
  };
}

function policyFor(
  profile: ProviderAgentEvalCase["input"]["profile"],
  now: () => number,
): LlmProviderConformancePolicy {
  return {
    provider: "OFFLINE_EVAL",
    model: "mtr-eval-model",
    version: "1.0.0",
    timeoutMs: profile === "TIMEOUT" ? 5 : 100,
    maxInputTokens: profile === "INPUT_BUDGET" ? 1 : 10_000,
    maxOutputTokens: profile === "OUTPUT_BUDGET" ? 10 : 10_000,
    maxRequestCostUsd: 0,
    requestsPerMinute: ["RATE_LIMIT", "SUBJECT_ISOLATION", "WINDOW_RESET"].includes(profile) ? 1 : 60,
    trainingAllowed: false,
    retentionAllowed: false,
    enabled: () => profile !== "DISABLED",
    estimateRequestCostUsd: () => profile === "COST_BUDGET" ? 0.01 : 0,
    now,
  };
}

function inputFor(profile: ProviderAgentEvalCase["input"]["profile"]): GroundedAgentInput {
  const message = profile === "SECRET_ASSIGNMENT"
    ? "token=secret-value Покажи остаток"
    : profile === "SECRET_BEARER"
      ? "Проверь Bearer abcdefghijklmnop"
      : "Покажи остаток SAP-DEMO-0001";
  const payload = profile === "SECRET_FACT_KEY"
    ? { materialCode: "SAP-DEMO-0001", apiToken: "must-not-survive" }
    : profile === "SECRET_NESTED_CREDENTIAL"
      ? { materialCode: "SAP-DEMO-0001", nested: { credentials: "must-not-survive" } }
      : { materialCode: "SAP-DEMO-0001", quantity: 10 };
  return {
    userId: "demo-user-001",
    threadId: "thread-provider-eval",
    message,
    facts: [{ source: "SAP.stock", payload }],
  };
}

function outputFor(profile: ProviderAgentEvalCase["input"]["profile"]): GroundedAgentOutput {
  const valid: GroundedAgentOutput = {
    answer: profile === "OUTPUT_BUDGET" ? "д".repeat(200) : "Подтверждённый ответ.",
    facts: ["Подтверждённый факт."],
    recommendations: [],
    citations: [],
    confidence: 0.8,
    requiresHumanReview: false,
    toolCalls: [],
  };
  if (profile === "INVALID_CONFIDENCE") return { ...valid, confidence: 7 };
  if (profile === "EMPTY_ANSWER") return { ...valid, answer: "" };
  if (profile === "INVALID_CITATION") {
    return {
      ...valid,
      citations: [{ sourceSystem: "SAP", entityId: "", versionOrSnapshot: "v1", clauseId: null }],
    };
  }
  if (profile === "INVALID_TOOL_OUTCOME") {
    return {
      ...valid,
      toolCalls: [{ tool: "sap.read", outcome: "SKIPPED" as "OK", durationMs: 1 }],
    };
  }
  return valid;
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return error instanceof Error ? error.name : "UNKNOWN_ERROR";
}

function countBy<T>(values: readonly T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[key(value)] = (counts[key(value)] ?? 0) + 1;
  return counts;
}

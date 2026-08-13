import { readFile } from "node:fs/promises";

import { createModelAnalyticalReadPort } from "@/adapters/mock/agent-analytical-read-port";
import type { TrustedRequestContext } from "@/application/authorization-service";
import { createAgentCommandRegistry } from "@/application/agent-orchestrator/command-registry";
import { parseAgentCommandRequest } from "@/application/agent-orchestrator/command-schemas";
import {
  MtrAgentOrchestrator,
  type AgentCommandOrchestratorRequest,
  type LegacyAgentCapability,
} from "@/application/agent-orchestrator/orchestrator";
import { projectAgentCommandResult } from "@/application/agent-orchestrator/public-projection";
import type { PermissionKey } from "@/domain/rbac";
import type { AgentOrchestratorPorts } from "@/ports/agent-orchestrator";
import { z } from "zod";

export const EXPECTED_ANALYTICAL_AGENT_EVAL_CASES = 50;

const filtersSchema = z
  .object({
    horizonWeeks: z.number().int().min(1).max(26).optional(),
    demandMultiplier: z.number().min(0.5).max(3).optional(),
    deliveryDelayDays: z.number().int().min(0).max(180).optional(),
  })
  .strict();

const analyticalEvalCaseSchema = z.object({
  id: z.string().min(1),
  split: z.enum(["calibration", "validation", "held-out", "adversarial"]),
  category: z.string().min(1),
  input: z.object({
    channel: z.enum(["COMMAND", "CHAT"]),
    positionId: z.string().min(1),
    message: z.string().min(1).optional(),
    requestedProjectId: z.string().min(1).optional(),
    permissionProfile: z.enum(["FULL", "MISSING_STOCK"]).default("FULL"),
    filters: filtersSchema.default({}),
  }).strict(),
  expected: z.object({
    errorCode: z.string().min(1).optional(),
    horizonWeeks: z.number().int().min(1).max(26).optional(),
    forecastAvailable: z.boolean().optional(),
    verifierPassed: z.boolean().optional(),
    recommendationAvailable: z.boolean().optional(),
    scenarioKinds: z.array(z.string()).optional(),
    citationSystems: z.array(z.string()).optional(),
    confidenceMin: z.number().min(0).max(1).optional(),
    confidenceMax: z.number().min(0).max(1).optional(),
    answerIncludes: z.array(z.string()).optional(),
    selectedModel: z.enum(["NAIVE_LAST", "MOVING_AVERAGE_4", "LINEAR_TREND"]).optional(),
    backtestOriginCount: z.number().int().nonnegative().optional(),
    assessedModelCount: z.number().int().nonnegative().optional(),
    intervalsValid: z.boolean().optional(),
    trendDirection: z.enum(["UP", "DOWN", "STABLE", "UNKNOWN"]).optional(),
    driverExpectations: z.array(z.object({
      id: z.string().min(1),
      status: z.enum(["UNTESTED", "SUPPORTED", "REFUTED", "UNKNOWN"]),
      relationship: z.enum(["CAUSAL", "ASSOCIATED", "NONE", "UNKNOWN"]),
    }).strict()).optional(),
    scenarioOrder: z.array(z.enum([
      "DIRECT",
      "SINGLE_SUBSTITUTE",
      "COMPOSITE_SUBSTITUTE",
      "PROCUREMENT",
    ])).optional(),
    recommendedScenarioKind: z.enum([
      "DIRECT",
      "SINGLE_SUBSTITUTE",
      "COMPOSITE_SUBSTITUTE",
      "PROCUREMENT",
    ]).optional(),
    maxDurationMs: z.number().positive().max(10_000),
  }).strict(),
}).strict();

export type AnalyticalAgentEvalCase = z.output<typeof analyticalEvalCaseSchema>;

export interface AnalyticalAgentEvalCaseResult {
  readonly id: string;
  readonly split: AnalyticalAgentEvalCase["split"];
  readonly category: string;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly failures: readonly string[];
}

export interface AnalyticalAgentEvalRunResult {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly cases: readonly AnalyticalAgentEvalCaseResult[];
}

export async function loadAnalyticalAgentEvalCases(
  filePath: string,
): Promise<AnalyticalAgentEvalCase[]> {
  const lines = (await readFile(filePath, "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const cases = lines.map((line, index) => {
    try {
      return analyticalEvalCaseSchema.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(`Некорректный analytical JSONL eval в строке ${index + 1}`, { cause: error });
    }
  });
  if (cases.length !== EXPECTED_ANALYTICAL_AGENT_EVAL_CASES) {
    throw new Error(
      `Ожидалось ${EXPECTED_ANALYTICAL_AGENT_EVAL_CASES} analytical eval-кейсов, получено ${cases.length}.`,
    );
  }
  if (new Set(cases.map((item) => item.id)).size !== cases.length) {
    throw new Error("Идентификаторы analytical eval-кейсов должны быть уникальными.");
  }
  const splitCounts = countBy(cases, (item) => item.split);
  if (
    splitCounts.calibration !== 4 ||
    splitCounts.validation !== 24 ||
    splitCounts["held-out"] !== 20 ||
    splitCounts.adversarial !== 2
  ) {
    throw new Error(
      "Analytical eval должен содержать 4 calibration, 24 validation, 20 held-out и 2 adversarial кейса.",
    );
  }
  return cases;
}

export async function runAnalyticalAgentEvals(
  cases: readonly AnalyticalAgentEvalCase[],
): Promise<AnalyticalAgentEvalRunResult> {
  const results: AnalyticalAgentEvalCaseResult[] = [];
  for (const evalCase of cases) results.push(await runCase(evalCase));
  const passed = results.filter((item) => item.passed).length;
  return { total: results.length, passed, failed: results.length - passed, cases: results };
}

async function runCase(evalCase: AnalyticalAgentEvalCase): Promise<AnalyticalAgentEvalCaseResult> {
  const failures: string[] = [];
  const started = performance.now();
  try {
    const orchestrator = createEvalOrchestrator();
    const projectId = evalCase.input.requestedProjectId ?? "demo-project-001";
    const selection = { projectId, positionId: evalCase.input.positionId };
    const request = evalCase.input.channel === "CHAT"
      ? {
          kind: "CHAT" as const,
          message: evalCase.input.message ?? `Почему ожидается дефицит по ${evalCase.input.positionId}?`,
          selection,
          correlationId: evalCase.id,
        }
      : commandRequest(selection, evalCase.input.filters, evalCase.id);
    const result = await orchestrator.handle(request, trusted(evalCase.input.permissionProfile));
    if (evalCase.expected.errorCode) {
      failures.push(`Ожидалась ошибка ${evalCase.expected.errorCode}, но runtime вернул результат.`);
    } else if (result.kind !== "COMMAND" || result.output.responseType !== "ANALYSIS") {
      failures.push("Runtime не вернул typed ANALYSIS result.");
    } else {
      verifyAnswer(evalCase, result.output.analysis, failures);
      const publicResult = projectAgentCommandResult(result.output, evalCase.id);
      const publicJson = JSON.stringify(publicResult);
      if (/technicalTrace|evidenceNodeIds|inputEvidenceNodeIds|toolCalls|chain.of.thought/iu.test(publicJson)) {
        failures.push("Public projection раскрывает технический payload.");
      }
      if (publicResult.requiresHumanReview !== true) {
        failures.push("Analytical result не требует human review.");
      }
    }
  } catch (error) {
    const actualCode = errorCode(error);
    if (!evalCase.expected.errorCode) {
      failures.push(`Неожиданная ошибка ${actualCode}.`);
    } else if (actualCode !== evalCase.expected.errorCode) {
      failures.push(`Ожидалась ошибка ${evalCase.expected.errorCode}, получена ${actualCode}.`);
    }
  }
  const durationMs = performance.now() - started;
  if (durationMs > evalCase.expected.maxDurationMs) {
    failures.push(
      `Время ${durationMs.toFixed(2)}ms превышает ${evalCase.expected.maxDurationMs}ms.`,
    );
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

function verifyAnswer(
  evalCase: AnalyticalAgentEvalCase,
  answer: Extract<
    Awaited<ReturnType<ReturnType<typeof createAgentCommandRegistry>["execute"]>>,
    { responseType: "ANALYSIS" }
  >["analysis"],
  failures: string[],
): void {
  const expected = evalCase.expected;
  const expectedHorizon = expected.horizonWeeks ?? evalCase.input.filters.horizonWeeks ?? 8;
  if (answer.scope.objectId !== evalCase.input.positionId) failures.push("Ответ относится к другой позиции.");
  if (answer.scope.projectId !== "demo-project-001") failures.push("Ответ относится к другому проекту.");
  if (answer.technicalTrace.datasetVersion !== "1.0.0-DEMO") failures.push("Не закреплена dataset version.");
  if (answer.technicalTrace.semanticRegistryVersion !== "semantic-registry-1.0.0") {
    failures.push("Не закреплена semantic registry version.");
  }
  if (expected.verifierPassed !== undefined && answer.technicalTrace.verifierPassed !== expected.verifierPassed) {
    failures.push("Verifier disposition не совпадает с oracle.");
  }
  if ((answer.forecast !== null) !== expected.forecastAvailable) {
    failures.push("Forecast availability не совпадает с oracle.");
  }
  if (answer.forecast && answer.forecast.horizonWeeks !== expectedHorizon) {
    failures.push(`Ожидался горизонт ${expectedHorizon}, получен ${answer.forecast.horizonWeeks}.`);
  }
  if ((answer.recommendation !== null) !== expected.recommendationAvailable) {
    failures.push("Recommendation availability не совпадает с oracle.");
  }
  for (const kind of expected.scenarioKinds ?? []) {
    if (!answer.scenarios.some((scenario) => scenario.kind === kind)) {
      failures.push(`Отсутствует сценарий ${kind}.`);
    }
  }
  if (expected.scenarioKinds?.length === 0 && answer.scenarios.length !== 0) {
    failures.push("Abstention неожиданно содержит сценарии.");
  }
  const actualSystems = [...new Set(answer.citations.map((citation) => citation.sourceSystem))].sort();
  const expectedSystems = [...(expected.citationSystems ?? [])].sort();
  if (JSON.stringify(actualSystems) !== JSON.stringify(expectedSystems)) {
    failures.push(`Источники ${actualSystems.join(",")} не совпадают с ${expectedSystems.join(",")}.`);
  }
  if (expected.confidenceMin !== undefined && answer.confidence < expected.confidenceMin) {
    failures.push(`Confidence ${answer.confidence} ниже ${expected.confidenceMin}.`);
  }
  if (expected.confidenceMax !== undefined && answer.confidence > expected.confidenceMax) {
    failures.push(`Confidence ${answer.confidence} выше ${expected.confidenceMax}.`);
  }
  for (const fragment of expected.answerIncludes ?? []) {
    if (!answer.executiveSummary.toLocaleLowerCase("ru-RU").includes(fragment.toLocaleLowerCase("ru-RU"))) {
      failures.push(`Executive summary не содержит «${fragment}».`);
    }
  }
  if (expected.selectedModel && answer.forecast?.selectedModel?.modelKey !== expected.selectedModel) {
    failures.push(
      `Ожидалась модель ${expected.selectedModel}, получена ${answer.forecast?.selectedModel?.modelKey ?? "none"}.`,
    );
  }
  if (
    expected.backtestOriginCount !== undefined &&
    answer.forecast?.selectedModel?.metrics.originCount !== expected.backtestOriginCount
  ) {
    failures.push(
      `Ожидалось rolling origins ${expected.backtestOriginCount}, получено ${answer.forecast?.selectedModel?.metrics.originCount ?? "none"}.`,
    );
  }
  if (
    expected.assessedModelCount !== undefined &&
    answer.forecast?.assessedModels.length !== expected.assessedModelCount
  ) {
    failures.push(
      `Ожидалось моделей ${expected.assessedModelCount}, получено ${answer.forecast?.assessedModels.length ?? "none"}.`,
    );
  }
  if (expected.intervalsValid) {
    if (!answer.forecast || answer.forecast.points.length !== answer.forecast.horizonWeeks) {
      failures.push("Forecast не содержит точку на каждый шаг горизонта.");
    } else if (answer.forecast.points.some((point) => point.lower > point.point || point.point > point.upper)) {
      failures.push("Forecast interval не содержит point estimate.");
    }
  }
  if (expected.trendDirection && answer.trend?.direction !== expected.trendDirection) {
    failures.push(
      `Ожидался тренд ${expected.trendDirection}, получен ${answer.trend?.direction ?? "none"}.`,
    );
  }
  for (const oracle of expected.driverExpectations ?? []) {
    const driver = answer.drivers.find((item) => item.id === oracle.id);
    if (!driver || driver.status !== oracle.status || driver.relationship !== oracle.relationship) {
      failures.push(
        `Driver ${oracle.id} не совпадает с oracle ${oracle.status}/${oracle.relationship}.`,
      );
    }
  }
  if (expected.scenarioOrder) {
    const actual = answer.scenarios.map((item) => item.kind);
    if (JSON.stringify(actual) !== JSON.stringify(expected.scenarioOrder)) {
      failures.push(`Порядок сценариев ${actual.join(",")} не совпадает с oracle.`);
    }
  }
  if (expected.recommendedScenarioKind) {
    const recommended = answer.scenarios.find(
      (scenario) => scenario.id === answer.recommendation?.optionId,
    );
    if (recommended?.kind !== expected.recommendedScenarioKind) {
      failures.push(
        `Ожидалась рекомендация ${expected.recommendedScenarioKind}, получена ${recommended?.kind ?? "none"}.`,
      );
    }
  }
  if (answer.requiresHumanReview !== true) failures.push("Domain answer не требует human review.");
}

function commandRequest(
  selection: { readonly projectId: string; readonly positionId: string },
  filters: z.output<typeof filtersSchema>,
  correlationId: string,
): AgentCommandOrchestratorRequest {
  parseAgentCommandRequest("ANALYSIS", { context: selection, filters });
  return {
    kind: "COMMAND",
    commandKey: "ANALYSIS",
    selection,
    filters,
    correlationId,
  };
}

function createEvalOrchestrator(): MtrAgentOrchestrator {
  return new MtrAgentOrchestrator(UNUSED_LEGACY, createAgentCommandRegistry(ports()));
}

const UNUSED_LEGACY: LegacyAgentCapability = {
  respond: async () => {
    throw new Error("LEGACY_RUNTIME_MUST_NOT_BE_CALLED");
  },
};

function ports(): AgentOrchestratorPorts {
  const unavailable = async () => ({
    items: [],
    evidence: {
      availability: "UNAVAILABLE" as const,
      confidence: 0,
      coverage: { requestedScope: [], checkedScope: [], complete: false },
      citations: [],
      missingData: [],
    },
  });
  return {
    summary: { read: async () => ({ facts: [], evidence: (await unavailable()).evidence }) },
    tasks: { listMine: unavailable },
    risks: { evaluate: unavailable },
    stocks: { search: unavailable },
    metrics: { calculate: async () => ({ metrics: [], evidence: (await unavailable()).evidence }) },
    analytics: createModelAnalyticalReadPort(),
  };
}

function trusted(profile: "FULL" | "MISSING_STOCK"): TrustedRequestContext {
  const permissions: PermissionKey[] = [
    "agent.chat",
    "analysis.read",
    "specification.read",
    "catalog.read",
  ];
  if (profile === "FULL") permissions.push("stock.search");
  return {
    subjectId: "demo-user-001",
    displayName: "Аналитик",
    activeRoleAssignmentIds: ["assign-demo-manager"],
    globalRoleKeys: [],
    activeProjectId: "demo-project-001",
    projectRoleKeys: ["PROJECT_MANAGER"],
    permissionKeys: new Set<PermissionKey>(permissions),
    catalogScopeIds: ["demo-catalog-001"],
    sourceScopeIds: ["demo-appius-001", "demo-sap-001", "demo-normative-001"],
    accessClaims: { warehouseIds: ["WH-NORTH", "WH-SOUTH", "WH-EAST", "WH-WEST"] },
    authorizationVersion: 1,
    requestId: "analytical-eval-request",
  };
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return error instanceof Error ? error.message : "UNKNOWN_ERROR";
}

function countBy<T, K extends string>(
  items: readonly T[],
  key: (item: T) => K,
): Partial<Record<K, number>> {
  const counts: Partial<Record<K, number>> = {};
  for (const item of items) {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

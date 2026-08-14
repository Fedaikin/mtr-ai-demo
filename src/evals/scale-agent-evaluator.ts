import { readFile } from "node:fs/promises";

import { z } from "zod";

import { generateAgentAnalyticalDataset } from "@/adapters/mock/fixtures/agent-analytical-dataset";
import type { TrustedRequestContext } from "@/application/authorization-service";
import { createAgentCommandRegistry } from "@/application/agent-orchestrator/command-registry";
import {
  MtrAgentOrchestrator,
  type LegacyAgentCapability,
} from "@/application/agent-orchestrator/orchestrator";
import { AnalyticalIntelligenceService } from "@/application/agent-orchestrator/analytics/analytical-intelligence-service";
import { projectAgentCommandResult } from "@/application/agent-orchestrator/public-projection";
import type { AnalyticalScenarioDataset } from "@/domain/agent/analytics/dataset";
import { AgentCommandExecutionError } from "@/domain/agent/errors";
import type { PermissionKey } from "@/domain/rbac";
import type { AgentOrchestratorPorts } from "@/ports/agent-orchestrator";

export const EXPECTED_SCALE_AGENT_EVAL_CASES = 20;
const REQUIRED_BATCH_CONCURRENCY = 10;

const scaleEvalCaseSchema = z.object({
  id: z.string().min(1),
  split: z.literal("scale"),
  category: z.enum(["portfolio-component", "portfolio-assembly", "intentional-negative", "analogue-boundary"]),
  maturity: z.enum(["I2", "I3", "I4"]),
  runtimeBoundary: z.literal("MTR_AGENT_ORCHESTRATOR"),
  datasetVersion: z.literal("g1-vertical-v1"),
  input: z.object({
    projectId: z.literal("demo-project-001"),
    specificationId: z.string().min(1),
    positionId: z.string().min(1),
    horizonWeeks: z.number().int().min(1).max(26),
  }).strict(),
  expected: z.object({
    itemKind: z.enum(["COMPONENT", "ASSEMBLY"]),
    mapped: z.boolean(),
    forecastAvailable: z.boolean(),
    recommendationAvailable: z.boolean(),
    requiresHumanReview: z.literal(true),
    maxDurationMs: z.number().positive().max(15_000),
    maxPublicBytes: z.number().int().positive().max(1_000_000),
  }).strict(),
}).strict();

export type ScaleAgentEvalCase = z.output<typeof scaleEvalCaseSchema>;

export interface ScaleAgentEvalCaseResult {
  readonly id: string;
  readonly category: ScaleAgentEvalCase["category"];
  readonly passed: boolean;
  readonly durationMs: number;
  readonly publicBytes: number;
  readonly failures: readonly string[];
}

export interface ScaleAgentEvalRunResult {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly maxConcurrent: number;
  readonly datasetLoads: number;
  readonly legacyCalls: number;
  readonly p95DurationMs: number;
  readonly cases: readonly ScaleAgentEvalCaseResult[];
}

export async function loadScaleAgentEvalCases(filePath: string): Promise<ScaleAgentEvalCase[]> {
  const lines = (await readFile(filePath, "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const cases = lines.map((line, index) => {
    try {
      return scaleEvalCaseSchema.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(`Некорректный scale JSONL eval в строке ${index + 1}`, { cause: error });
    }
  });
  if (cases.length !== EXPECTED_SCALE_AGENT_EVAL_CASES) {
    throw new Error(
      `Ожидалось ${EXPECTED_SCALE_AGENT_EVAL_CASES} scale eval-кейсов, получено ${cases.length}.`,
    );
  }
  if (new Set(cases.map((item) => item.id)).size !== cases.length) {
    throw new Error("Идентификаторы scale eval-кейсов должны быть уникальными.");
  }
  if (new Set(cases.map((item) => item.input.positionId)).size !== cases.length) {
    throw new Error("Каждый scale eval должен использовать отдельную позицию портфеля.");
  }
  if (new Set(cases.map((item) => item.input.specificationId)).size < 12) {
    throw new Error("Scale eval должен покрывать не менее 12 спецификаций.");
  }
  const categories = countBy(cases, (item) => item.category);
  if (
    categories["portfolio-component"] !== 12 ||
    categories["portfolio-assembly"] !== 4 ||
    categories["intentional-negative"] !== 2 ||
    categories["analogue-boundary"] !== 2
  ) {
    throw new Error("Scale eval не соответствует закреплённой стратификации 12/4/2/2.");
  }
  return cases;
}

export async function runScaleAgentEvals(
  cases: readonly ScaleAgentEvalCase[],
): Promise<ScaleAgentEvalRunResult> {
  const dataset = generateAgentAnalyticalDataset();
  const runtime = createScaleRuntime(dataset);
  const results: ScaleAgentEvalCaseResult[] = [];
  for (let offset = 0; offset < cases.length; offset += REQUIRED_BATCH_CONCURRENCY) {
    const batch = cases.slice(offset, offset + REQUIRED_BATCH_CONCURRENCY);
    results.push(...await Promise.all(batch.map((item) => runCase(item, cases, dataset, runtime))));
  }

  const globalFailures: string[] = [];
  if (runtime.maxConcurrent() < REQUIRED_BATCH_CONCURRENCY) {
    globalFailures.push(
      `Ожидалось ${REQUIRED_BATCH_CONCURRENCY} одновременных запросов, зафиксировано ${runtime.maxConcurrent()}.`,
    );
  }
  if (runtime.datasetLoads() !== cases.length) {
    globalFailures.push(`Dataset port вызван ${runtime.datasetLoads()} раз вместо ${cases.length}.`);
  }
  if (runtime.legacyCalls() !== 0) {
    globalFailures.push(`Scale command ушёл в legacy/LLM runtime ${runtime.legacyCalls()} раз.`);
  }
  if (globalFailures.length > 0 && results[0]) {
    results[0] = {
      ...results[0],
      passed: false,
      failures: [...results[0].failures, ...globalFailures],
    };
  }
  const passed = results.filter((item) => item.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    maxConcurrent: runtime.maxConcurrent(),
    datasetLoads: runtime.datasetLoads(),
    legacyCalls: runtime.legacyCalls(),
    p95DurationMs: nearestRankP95(results.map((item) => item.durationMs)),
    cases: results,
  };
}

interface ScaleRuntime {
  readonly orchestrator: MtrAgentOrchestrator;
  readonly maxConcurrent: () => number;
  readonly datasetLoads: () => number;
  readonly legacyCalls: () => number;
}

async function runCase(
  evalCase: ScaleAgentEvalCase,
  allCases: readonly ScaleAgentEvalCase[],
  dataset: AnalyticalScenarioDataset,
  runtime: ScaleRuntime,
): Promise<ScaleAgentEvalCaseResult> {
  const started = performance.now();
  const failures: string[] = [];
  let publicBytes = 0;
  const position = dataset.positions.find((item) => item.positionId === evalCase.input.positionId);
  if (!position) {
    failures.push("Позиция отсутствует в санкционированной когорте.");
  } else {
    const mapped = Boolean(position.catalogItemCode && position.sapMaterialCode);
    if (position.specificationId !== evalCase.input.specificationId) failures.push("Oracle specificationId не совпадает.");
    if (position.itemKind !== evalCase.expected.itemKind) failures.push("Oracle itemKind не совпадает.");
    if (mapped !== evalCase.expected.mapped) failures.push("Oracle mapping disposition не совпадает.");
  }

  try {
    const result = await runtime.orchestrator.handle({
      kind: "COMMAND",
      commandKey: "ANALYSIS",
      selection: {
        projectId: evalCase.input.projectId,
        specificationId: evalCase.input.specificationId,
        positionId: evalCase.input.positionId,
      },
      filters: {
        positionId: evalCase.input.positionId,
        horizonWeeks: evalCase.input.horizonWeeks,
      },
      correlationId: evalCase.id,
    }, trusted(evalCase.id));
    if (result.kind !== "COMMAND" || result.output.responseType !== "ANALYSIS") {
      failures.push("Scale runtime не вернул typed ANALYSIS result.");
    } else {
      const answer = result.output.analysis;
      if (answer.scope.objectId !== evalCase.input.positionId) failures.push("Ответ смешал position context.");
      if (answer.scope.projectId !== evalCase.input.projectId) failures.push("Ответ смешал project context.");
      if ((answer.forecast !== null) !== evalCase.expected.forecastAvailable) failures.push("Forecast availability не совпадает с oracle.");
      if ((answer.recommendation !== null) !== evalCase.expected.recommendationAvailable) failures.push("Recommendation availability не совпадает с oracle.");
      if (answer.requiresHumanReview !== evalCase.expected.requiresHumanReview) failures.push("Human review gate потерян.");
      const projected = projectAgentCommandResult(result.output, evalCase.id);
      const serialized = JSON.stringify(projected);
      publicBytes = Buffer.byteLength(serialized, "utf8");
      if (publicBytes > evalCase.expected.maxPublicBytes) failures.push(`Public payload ${publicBytes} B превышает лимит.`);
      if (/technicalTrace|evidenceNodeIds|inputEvidenceNodeIds|toolCalls|chain.of.thought/iu.test(serialized)) {
        failures.push("Public scale projection раскрывает технический payload.");
      }
      const foreignIds = allCases
        .map((item) => item.input.positionId)
        .filter((id) => id !== evalCase.input.positionId);
      if (foreignIds.some((id) => serialized.includes(id))) failures.push("Public output содержит позицию другого concurrent request.");
    }
  } catch (error) {
    failures.push(`Неожиданная runtime ошибка: ${errorCode(error)}.`);
  }
  const durationMs = performance.now() - started;
  if (durationMs > evalCase.expected.maxDurationMs) {
    failures.push(`Время ${durationMs.toFixed(2)}ms превышает ${evalCase.expected.maxDurationMs}ms.`);
  }
  return {
    id: evalCase.id,
    category: evalCase.category,
    passed: failures.length === 0,
    durationMs,
    publicBytes,
    failures,
  };
}

function createScaleRuntime(dataset: AnalyticalScenarioDataset): ScaleRuntime {
  let active = 0;
  let peak = 0;
  let loads = 0;
  let legacy = 0;
  const service = new AnalyticalIntelligenceService({
    async load(projectId) {
      loads += 1;
      if (projectId !== "demo-project-001") throw new Error("ANALYTICAL_PROJECT_SCOPE_DENIED");
      return dataset;
    },
  });
  const analytics: NonNullable<AgentOrchestratorPorts["analytics"]> = {
    async analyze(context, query) {
      active += 1;
      peak = Math.max(peak, active);
      try {
        await Promise.resolve();
        if (
          query.selection.projectId !== context.trusted.activeProjectId ||
          query.selection.validatedSubjectId !== context.trusted.subjectId ||
          query.selection.validatedAgainstAuthorizationVersion !== context.trusted.authorizationVersion
        ) {
          throw new AgentCommandExecutionError("AGENT_SELECTION_STALE");
        }
        return await service.analyze({
          question: query.question,
          projectId: query.selection.projectId,
          positionId: query.positionId,
          horizonWeeks: query.horizonWeeks,
          demandMultiplier: query.demandMultiplier,
          deliveryDelayDays: query.deliveryDelayDays,
        });
      } finally {
        active -= 1;
      }
    },
  };
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
  const ports: AgentOrchestratorPorts = {
    summary: { read: async () => ({ facts: [], evidence: (await unavailable()).evidence }) },
    tasks: { listMine: unavailable },
    risks: { evaluate: unavailable },
    stocks: { search: unavailable },
    metrics: { calculate: async () => ({ metrics: [], evidence: (await unavailable()).evidence }) },
    analytics,
  };
  const legacyCapability: LegacyAgentCapability = {
    respond: async () => {
      legacy += 1;
      throw new Error("SCALE_MUST_NOT_USE_LEGACY_LLM");
    },
  };
  return {
    orchestrator: new MtrAgentOrchestrator(legacyCapability, createAgentCommandRegistry(ports)),
    maxConcurrent: () => peak,
    datasetLoads: () => loads,
    legacyCalls: () => legacy,
  };
}

function trusted(requestId: string): TrustedRequestContext {
  const permissionKeys: PermissionKey[] = [
    "agent.chat",
    "analysis.read",
    "specification.read",
    "catalog.read",
    "stock.search",
  ];
  return {
    subjectId: "demo-user-001",
    displayName: "Аналитик",
    activeRoleAssignmentIds: ["assign-demo-manager"],
    globalRoleKeys: [],
    activeProjectId: "demo-project-001",
    projectRoleKeys: ["PROJECT_MANAGER"],
    permissionKeys: new Set(permissionKeys),
    catalogScopeIds: ["demo-catalog-001"],
    sourceScopeIds: ["demo-appius-001", "demo-sap-001", "demo-normative-001"],
    accessClaims: { warehouseIds: ["WH-NORTH", "WH-SOUTH", "WH-EAST", "WH-WEST"] },
    authorizationVersion: 1,
    requestId,
  };
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return error instanceof Error ? error.message : "UNKNOWN_ERROR";
}

function nearestRankP95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const output: Record<string, number> = {};
  for (const item of items) output[key(item)] = (output[key(item)] ?? 0) + 1;
  return output;
}

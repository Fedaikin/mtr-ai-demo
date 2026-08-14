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
import {
  AgentFeedbackService,
  type AgentLearningAuditEnvelope,
  type AgentLearningStore,
  type AgentLearningSubmission,
} from "@/application/agent-orchestrator/learning-service";
import type { PublicAnalyticalAnswer } from "@/domain/agent/analytics/answer";
import type { AnalyticalScenarioDataset } from "@/domain/agent/analytics/dataset";
import { AgentCommandExecutionError } from "@/domain/agent/errors";
import {
  AGENT_FEEDBACK_KINDS,
  type AgentLearningCandidate,
} from "@/domain/agent/learning";
import type { PermissionKey } from "@/domain/rbac";
import type { AgentOrchestratorPorts } from "@/ports/agent-orchestrator";

export const EXPECTED_MULTI_TURN_AGENT_EVAL_CASES = 27;

const multiTurnEvalCaseSchema = z.object({
  id: z.string().min(1),
  split: z.enum(["validation", "held-out", "regression"]),
  category: z.enum(["sensitivity-follow-up", "feedback-quarantine"]),
  maturity: z.enum(["I3", "I4", "A2"]),
  runtimeBoundary: z.literal("MTR_AGENT_ORCHESTRATOR"),
  datasetVersion: z.literal("g1-vertical-v1"),
  input: z.object({
    projectId: z.literal("demo-project-001"),
    specificationId: z.string().min(1),
    positionId: z.string().min(1),
    baseHorizonWeeks: z.number().int().min(1).max(26),
    followUpHorizonWeeks: z.number().int().min(1).max(26).optional(),
    feedbackKind: z.enum(AGENT_FEEDBACK_KINDS).optional(),
    feedbackSummary: z.string().min(1).max(500).optional(),
  }).strict(),
  expected: z.object({
    turnCount: z.literal(3),
    restoredEquivalent: z.literal(true),
    followUpForecastPoints: z.number().int().positive().optional(),
    feedbackStatus: z.literal("QUARANTINED").optional(),
    onlineBehaviorChanged: z.literal(false),
    provenancePreserved: z.literal(true),
    maxDurationMs: z.number().positive().max(15_000),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.category === "sensitivity-follow-up") {
    if (!value.input.followUpHorizonWeeks || value.input.feedbackKind) {
      context.addIssue({ code: "custom", message: "Sensitivity case требует только followUpHorizonWeeks." });
    }
    if (value.expected.followUpForecastPoints !== value.input.followUpHorizonWeeks) {
      context.addIssue({ code: "custom", message: "Follow-up oracle должен совпадать с горизонтом." });
    }
  } else if (!value.input.feedbackKind || !value.expected.feedbackStatus) {
    context.addIssue({ code: "custom", message: "Feedback case требует feedbackKind и feedbackStatus." });
  }
});

export type MultiTurnAgentEvalCase = z.output<typeof multiTurnEvalCaseSchema>;

export interface MultiTurnAgentEvalRunResult {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly legacyCalls: number;
  readonly cases: readonly {
    readonly id: string;
    readonly category: MultiTurnAgentEvalCase["category"];
    readonly passed: boolean;
    readonly durationMs: number;
    readonly failures: readonly string[];
  }[];
}

export async function loadMultiTurnAgentEvalCases(filePath: string): Promise<MultiTurnAgentEvalCase[]> {
  const lines = (await readFile(filePath, "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const cases = lines.map((line, index) => {
    try {
      return multiTurnEvalCaseSchema.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(`Некорректный multi-turn JSONL eval в строке ${index + 1}`, { cause: error });
    }
  });
  if (cases.length !== EXPECTED_MULTI_TURN_AGENT_EVAL_CASES) {
    throw new Error(
      `Ожидалось ${EXPECTED_MULTI_TURN_AGENT_EVAL_CASES} multi-turn eval-кейсов, получено ${cases.length}.`,
    );
  }
  if (new Set(cases.map((item) => item.id)).size !== cases.length) {
    throw new Error("Идентификаторы multi-turn eval-кейсов должны быть уникальными.");
  }
  const categories = countBy(cases, (item) => item.category);
  if (categories["sensitivity-follow-up"] !== 15 || categories["feedback-quarantine"] !== 12) {
    throw new Error("Multi-turn eval должен содержать 15 sensitivity и 12 feedback conversations.");
  }
  const splits = countBy(cases, (item) => item.split);
  if (splits.validation !== 9 || splits["held-out"] !== 9 || splits.regression !== 9) {
    throw new Error("Multi-turn eval должен содержать по 9 validation, held-out и regression кейсов.");
  }
  return cases;
}

export async function runMultiTurnAgentEvals(
  cases: readonly MultiTurnAgentEvalCase[],
): Promise<MultiTurnAgentEvalRunResult> {
  const dataset = generateAgentAnalyticalDataset();
  const runtime = createConversationRuntime(dataset);
  const results: MultiTurnAgentEvalRunResult["cases"][number][] = [];
  for (const evalCase of cases) results.push(await runCase(evalCase, dataset, runtime));
  if (runtime.legacyCalls() !== 0 && results[0]) {
    results[0] = {
      ...results[0],
      passed: false,
      failures: [...results[0].failures, `Multi-turn ANALYSIS ушёл в legacy/LLM ${runtime.legacyCalls()} раз.`],
    };
  }
  const passed = results.filter((item) => item.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    legacyCalls: runtime.legacyCalls(),
    cases: results,
  };
}

interface ConversationRuntime {
  readonly orchestrator: MtrAgentOrchestrator;
  readonly legacyCalls: () => number;
}

async function runCase(
  evalCase: MultiTurnAgentEvalCase,
  dataset: AnalyticalScenarioDataset,
  runtime: ConversationRuntime,
): Promise<MultiTurnAgentEvalRunResult["cases"][number]> {
  const started = performance.now();
  const failures: string[] = [];
  const threadId = `thread-${evalCase.id}`;
  const position = dataset.positions.find((item) => item.positionId === evalCase.input.positionId);
  if (!position || position.specificationId !== evalCase.input.specificationId) {
    failures.push("Conversation oracle не найден в санкционированной когорте.");
  }
  if (!position?.catalogItemCode || !position.sapMaterialCode) {
    failures.push("Multi-turn кейс должен использовать mapped position.");
  }

  try {
    const first = await analyzeTurn(runtime.orchestrator, evalCase, threadId, evalCase.input.baseHorizonWeeks, "turn-1");
    let third: PublicAnalyticalAnswer;
    if (evalCase.category === "sensitivity-follow-up") {
      const followUpWeeks = evalCase.input.followUpHorizonWeeks!;
      const second = await analyzeTurn(runtime.orchestrator, evalCase, threadId, followUpWeeks, "turn-2", true);
      if (second.forecast?.points.length !== evalCase.expected.followUpForecastPoints) {
        failures.push("Follow-up не применил новый горизонт прогноза.");
      }
      if (first.forecast?.points.length === second.forecast?.points.length) {
        failures.push("Follow-up не изменил аналитический горизонт.");
      }
      if (second.scope.objectId !== first.scope.objectId || second.scope.projectId !== first.scope.projectId) {
        failures.push("Follow-up смешал conversation context.");
      }
      third = await analyzeTurn(runtime.orchestrator, evalCase, threadId, evalCase.input.baseHorizonWeeks, "turn-3", true);
    } else {
      const store = new ConversationLearningStore(first, evalCase);
      const feedback = new AgentFeedbackService(store, fixedNow);
      const receipt = await feedback.submit({
        responseMessageId: `assistant-${evalCase.id}-turn-1`,
        feedbackKind: evalCase.input.feedbackKind!,
        ...(evalCase.input.feedbackSummary ? { summary: evalCase.input.feedbackSummary } : {}),
      }, trusted(`${evalCase.id}-feedback`));
      if (receipt.status !== evalCase.expected.feedbackStatus) failures.push("Feedback не остался в карантине.");
      if (store.auditActions.join(",") !== "agent.feedback.submitted") {
        failures.push("Feedback lifecycle выполнил недопустимый online transition.");
      }
      if (!store.provenanceMatches(first)) failures.push("Feedback потерял model/rule/evidence provenance.");
      third = await analyzeTurn(runtime.orchestrator, evalCase, threadId, evalCase.input.baseHorizonWeeks, "turn-3", true);
    }

    if (evalCase.expected.restoredEquivalent && stableAnswer(first) !== stableAnswer(third)) {
      failures.push("Возврат к исходному вопросу не восстановил детерминированный ответ.");
    }
    if (evalCase.expected.onlineBehaviorChanged === false && first.technicalTrace.datasetVersion !== third.technicalTrace.datasetVersion) {
      failures.push("Conversation самопроизвольно изменила dataset/model behavior online.");
    }
    if (evalCase.expected.provenancePreserved) {
      if (
        first.technicalTrace.semanticRegistryVersion !== third.technicalTrace.semanticRegistryVersion ||
        first.forecast?.selectedModel?.modelVersion !== third.forecast?.selectedModel?.modelVersion
      ) {
        failures.push("Conversation потеряла semantic/forecast version provenance.");
      }
    }
  } catch (error) {
    failures.push(`Неожиданная multi-turn ошибка: ${errorCode(error)}.`);
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
    failures,
  };
}

async function analyzeTurn(
  orchestrator: MtrAgentOrchestrator,
  evalCase: MultiTurnAgentEvalCase,
  threadId: string,
  horizonWeeks: number,
  turn: string,
  elliptical = false,
): Promise<PublicAnalyticalAnswer> {
  const days = horizonWeeks * 7;
  const message = elliptical
    ? `Что если горизонт ${days} дней?`
    : `Почему ожидается дефицит по ${evalCase.input.positionId} на ${days} дней?`;
  const result = await orchestrator.handle({
    kind: "CHAT",
    message,
    threadId,
    selection: {
      projectId: evalCase.input.projectId,
      specificationId: evalCase.input.specificationId,
      positionId: evalCase.input.positionId,
    },
    correlationId: `${evalCase.id}-${turn}`,
  }, trusted(`${evalCase.id}-${turn}`));
  if (result.kind !== "COMMAND" || result.output.responseType !== "ANALYSIS") {
    throw new Error("MULTI_TURN_TYPED_ANALYSIS_REQUIRED");
  }
  if (result.output.analysis.requiresHumanReview !== true) {
    throw new Error("MULTI_TURN_HUMAN_REVIEW_REQUIRED");
  }
  return result.output.analysis;
}

function createConversationRuntime(dataset: AnalyticalScenarioDataset): ConversationRuntime {
  let legacy = 0;
  const service = new AnalyticalIntelligenceService({
    async load(projectId) {
      if (projectId !== "demo-project-001") throw new Error("ANALYTICAL_PROJECT_SCOPE_DENIED");
      return dataset;
    },
  });
  const analytics: NonNullable<AgentOrchestratorPorts["analytics"]> = {
    async analyze(context, query) {
      if (
        query.selection.projectId !== context.trusted.activeProjectId ||
        query.selection.validatedSubjectId !== context.trusted.subjectId ||
        query.selection.validatedAgainstAuthorizationVersion !== context.trusted.authorizationVersion
      ) {
        throw new AgentCommandExecutionError("AGENT_SELECTION_STALE");
      }
      return service.analyze({
        question: query.question,
        projectId: query.selection.projectId,
        positionId: query.positionId,
        horizonWeeks: query.horizonWeeks,
        demandMultiplier: query.demandMultiplier,
        deliveryDelayDays: query.deliveryDelayDays,
      });
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
      throw new Error("MULTI_TURN_ANALYSIS_MUST_NOT_USE_LEGACY_LLM");
    },
  };
  return {
    orchestrator: new MtrAgentOrchestrator(legacyCapability, createAgentCommandRegistry(ports)),
    legacyCalls: () => legacy,
  };
}

class ConversationLearningStore implements AgentLearningStore {
  readonly auditActions: string[] = [];
  private candidate: AgentLearningCandidate | null = null;

  constructor(
    private readonly source: PublicAnalyticalAnswer,
    private readonly evalCase: MultiTurnAgentEvalCase,
  ) {}

  async submitWithAudit(
    input: AgentLearningSubmission,
    audit: AgentLearningAuditEnvelope,
  ): Promise<AgentLearningCandidate> {
    if (this.candidate) return this.candidate;
    this.candidate = {
      id: input.id,
      projectId: input.projectId,
      ownerUserId: input.ownerUserId,
      responseMessageId: input.responseMessageId,
      caseId: `case-${this.evalCase.id}`,
      feedbackKind: input.feedbackKind,
      status: "QUARANTINED",
      sanitizedSummary: input.sanitizedSummary,
      sourcePromptVersion: "prompt-3.0.0",
      sourceModelVersion: "deterministic-runtime-v1",
      sourceRuleVersions: [this.source.technicalTrace.semanticRegistryVersion],
      sourceEvidenceVersion: this.source.technicalTrace.evidenceGraphId,
      applicability: null,
      regressionCaseId: null,
      validationChecksum: null,
      validationSummary: null,
      idempotencyKey: input.idempotencyKey,
      authorizationVersion: input.authorizationVersion,
      roleAssignmentSnapshot: input.roleAssignmentSnapshot,
      approvedByUserId: null,
      promotedByUserId: null,
      rejectedByUserId: null,
      revokedByUserId: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      approvedAt: null,
      promotedAt: null,
      rejectedAt: null,
      revokedAt: null,
      version: 1,
    };
    this.auditActions.push(audit.action);
    return this.candidate;
  }

  async getForProject(id: string, projectId: string): Promise<AgentLearningCandidate | null> {
    return this.candidate?.id === id && this.candidate.projectId === projectId ? this.candidate : null;
  }

  async transitionWithAudit(): Promise<AgentLearningCandidate> {
    throw new Error("MULTI_TURN_FEEDBACK_MUST_NOT_TRANSITION_ONLINE");
  }

  provenanceMatches(answer: PublicAnalyticalAnswer): boolean {
    return Boolean(
      this.candidate &&
      this.candidate.status === "QUARANTINED" &&
      this.candidate.sourcePromptVersion === "prompt-3.0.0" &&
      this.candidate.sourceModelVersion === "deterministic-runtime-v1" &&
      this.candidate.sourceRuleVersions.join(",") === answer.technicalTrace.semanticRegistryVersion &&
      this.candidate.sourceEvidenceVersion === answer.technicalTrace.evidenceGraphId,
    );
  }
}

function trusted(requestId: string): TrustedRequestContext {
  const permissionKeys: PermissionKey[] = [
    "agent.chat",
    "analysis.read",
    "specification.read",
    "catalog.read",
    "stock.search",
    "review.decide",
    "prompt.activate",
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

function fixedNow(): Date {
  return new Date("2026-08-13T17:00:00.000Z");
}

function stableAnswer(answer: PublicAnalyticalAnswer): string {
  return JSON.stringify(answer);
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return error instanceof Error ? error.message : "UNKNOWN_ERROR";
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const output: Record<string, number> = {};
  for (const item of items) output[key(item)] = (output[key(item)] ?? 0) + 1;
  return output;
}

import { readFile } from "node:fs/promises";

import {
  AuthorizationError,
  type TrustedRequestContext,
} from "@/application/authorization-service";
import {
  type AgentLearningAuditEnvelope,
  AgentFeedbackService,
  AgentLearningCurationService,
  AgentLearningError,
  type AgentLearningStore,
  type AgentLearningSubmission,
  type AgentLearningTransition,
} from "@/application/agent-orchestrator/learning-service";
import {
  AGENT_FEEDBACK_KINDS,
  AGENT_LEARNING_CANDIDATE_STATUSES,
  type AgentLearningCandidate,
} from "@/domain/agent/learning";
import type { PermissionKey } from "@/domain/rbac";
import { z } from "zod";

export const EXPECTED_LEARNING_AGENT_EVAL_CASES = 17;

const operationSchema = z.enum([
  "APPROVE_VALID",
  "APPROVE_INVALID_CHECKSUM",
  "PROMOTE",
  "REJECT",
  "REVOKE",
]);

const learningEvalCaseSchema = z.object({
  id: z.string().min(1),
  split: z.enum(["validation", "held-out", "adversarial"]),
  category: z.string().min(1),
  input: z.object({
    feedbackKind: z.enum(AGENT_FEEDBACK_KINDS),
    summary: z.string().max(500).optional(),
    contextProfile: z.enum(["OWNER", "NO_CHAT", "NO_PROJECT"]).default("OWNER"),
    storeProfile: z.enum(["NORMAL", "FOREIGN_MESSAGE", "CONFLICT_ON_TRANSITION"]).default("NORMAL"),
    operations: z.array(operationSchema).default([]),
  }).strict(),
  expected: z.object({
    errorCode: z.string().min(1).optional(),
    finalStatus: z.enum(AGENT_LEARNING_CANDIDATE_STATUSES).optional(),
    auditActions: z.array(z.string()),
    provenancePreserved: z.boolean().default(true),
    maxDurationMs: z.number().positive().max(10_000),
  }).strict(),
}).strict();

export type LearningAgentEvalCase = z.output<typeof learningEvalCaseSchema>;

export interface LearningAgentEvalResult {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly cases: readonly {
    readonly id: string;
    readonly split: LearningAgentEvalCase["split"];
    readonly category: string;
    readonly passed: boolean;
    readonly durationMs: number;
    readonly failures: readonly string[];
  }[];
}

export async function loadLearningAgentEvalCases(filePath: string): Promise<LearningAgentEvalCase[]> {
  const lines = (await readFile(filePath, "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const cases = lines.map((line, index) => {
    try {
      return learningEvalCaseSchema.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(`Некорректный learning JSONL eval в строке ${index + 1}`, { cause: error });
    }
  });
  if (cases.length !== EXPECTED_LEARNING_AGENT_EVAL_CASES) {
    throw new Error(
      `Ожидалось ${EXPECTED_LEARNING_AGENT_EVAL_CASES} learning eval-кейсов, получено ${cases.length}.`,
    );
  }
  if (new Set(cases.map((item) => item.id)).size !== cases.length) {
    throw new Error("Идентификаторы learning eval-кейсов должны быть уникальными.");
  }
  const splitCounts = countBy(cases, (item) => item.split);
  if (splitCounts.validation !== 9 || splitCounts["held-out"] !== 4 || splitCounts.adversarial !== 4) {
    throw new Error("Learning eval должен содержать 9 validation, 4 held-out и 4 adversarial кейса.");
  }
  return cases;
}

export async function runLearningAgentEvals(
  cases: readonly LearningAgentEvalCase[],
): Promise<LearningAgentEvalResult> {
  const results: LearningAgentEvalResult["cases"][number][] = [];
  for (const evalCase of cases) results.push(await runCase(evalCase));
  const passed = results.filter((item) => item.passed).length;
  return { total: results.length, passed, failed: results.length - passed, cases: results };
}

async function runCase(
  evalCase: LearningAgentEvalCase,
): Promise<LearningAgentEvalResult["cases"][number]> {
  const failures: string[] = [];
  const started = performance.now();
  const store = new EvalLearningStore(evalCase.input.storeProfile);
  const context = trusted(evalCase.input.contextProfile);
  let actualError: string | null = null;
  let candidateId: string | null = null;
  try {
    const feedback = new AgentFeedbackService(store, fixedNow);
    const curator = new AgentLearningCurationService(store, fixedNow);
    const receipt = await feedback.submit({
      responseMessageId: `assistant-${evalCase.id}`,
      feedbackKind: evalCase.input.feedbackKind,
      ...(evalCase.input.summary === undefined ? {} : { summary: evalCase.input.summary }),
    }, context);
    candidateId = receipt.candidateId;
    for (const operation of evalCase.input.operations) {
      if (operation === "APPROVE_VALID") {
        await curator.approve(receipt.candidateId, validApproval(evalCase.id), context);
      } else if (operation === "APPROVE_INVALID_CHECKSUM") {
        await curator.approve(receipt.candidateId, {
          ...validApproval(evalCase.id),
          validationChecksum: "not-a-checksum",
        }, context);
      } else if (operation === "PROMOTE") {
        await curator.promote(receipt.candidateId, context);
      } else if (operation === "REJECT") {
        await curator.reject(receipt.candidateId, "Кандидат не прошёл проверку.", context);
      } else {
        await curator.revoke(receipt.candidateId, "Выявлена регрессия после продвижения.", context);
      }
    }
  } catch (error) {
    actualError = errorCode(error);
  }

  if ((evalCase.expected.errorCode ?? null) !== actualError) {
    failures.push(`Ожидалась ошибка ${evalCase.expected.errorCode ?? "none"}, получена ${actualError ?? "none"}.`);
  }
  const candidate = candidateId ? store.peek(candidateId) : null;
  if (evalCase.expected.finalStatus && candidate?.status !== evalCase.expected.finalStatus) {
    failures.push(`Ожидался статус ${evalCase.expected.finalStatus}, получен ${candidate?.status ?? "none"}.`);
  }
  if (JSON.stringify(store.auditActions) !== JSON.stringify(evalCase.expected.auditActions)) {
    failures.push(`Audit ${store.auditActions.join(",")} не совпадает с oracle.`);
  }
  if (candidate && evalCase.expected.provenancePreserved) {
    if (
      candidate.sourcePromptVersion !== "prompt-3.0.0" ||
      candidate.sourceModelVersion !== "deterministic-runtime-v1" ||
      candidate.sourceEvidenceVersion !== "evidence-graph-eval-v1" ||
      candidate.sourceRuleVersions.join(",") !== "semantic-registry-1.0.0"
    ) {
      failures.push("Версии prompt/model/rules/evidence изменились в learning lifecycle.");
    }
  }
  if (candidate?.status === "PROMOTED" || candidate?.status === "REVOKED") {
    if (!candidate.regressionCaseId || !candidate.validationChecksum || !candidate.applicability) {
      failures.push("Продвижение прошло без полного regression bundle.");
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

class EvalLearningStore implements AgentLearningStore {
  readonly auditActions: string[] = [];
  private candidate: AgentLearningCandidate | null = null;

  constructor(private readonly profile: LearningAgentEvalCase["input"]["storeProfile"]) {}

  async submitWithAudit(
    input: AgentLearningSubmission,
    audit: AgentLearningAuditEnvelope,
  ): Promise<AgentLearningCandidate> {
    if (this.profile === "FOREIGN_MESSAGE") {
      throw new AgentLearningError("AGENT_FEEDBACK_ACCESS_DENIED", "Отзыв недоступен");
    }
    if (this.candidate) return this.candidate;
    this.candidate = {
      id: input.id,
      projectId: input.projectId,
      ownerUserId: input.ownerUserId,
      responseMessageId: input.responseMessageId,
      caseId: "case-learning-eval",
      feedbackKind: input.feedbackKind,
      status: "QUARANTINED",
      sanitizedSummary: input.sanitizedSummary,
      sourcePromptVersion: "prompt-3.0.0",
      sourceModelVersion: "deterministic-runtime-v1",
      sourceRuleVersions: ["semantic-registry-1.0.0"],
      sourceEvidenceVersion: "evidence-graph-eval-v1",
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
    return this.candidate?.id === id && this.candidate.projectId === projectId
      ? this.candidate
      : null;
  }

  async transitionWithAudit(
    id: string,
    projectId: string,
    version: number,
    transition: AgentLearningTransition,
    audit: AgentLearningAuditEnvelope,
  ): Promise<AgentLearningCandidate> {
    if (this.profile === "CONFLICT_ON_TRANSITION") {
      throw new AgentLearningError("AGENT_LEARNING_CONFLICT", "Кандидат уже изменён");
    }
    const current = this.candidate;
    if (
      !current || current.id !== id || current.projectId !== projectId ||
      current.version !== version || !transition.expectedStatuses.includes(current.status)
    ) {
      throw new AgentLearningError("AGENT_LEARNING_CONFLICT", "Кандидат уже изменён");
    }
    this.candidate = {
      ...current,
      status: transition.status,
      authorizationVersion: transition.authorizationVersion,
      roleAssignmentSnapshot: transition.roleAssignmentSnapshot,
      updatedAt: transition.updatedAt,
      version: current.version + 1,
      applicability: transition.applicability ?? current.applicability,
      regressionCaseId: transition.regressionCaseId ?? current.regressionCaseId,
      validationChecksum: transition.validationChecksum ?? current.validationChecksum,
      validationSummary: transition.validationSummary ?? transition.reason ?? current.validationSummary,
      approvedByUserId: transition.status === "APPROVED" ? transition.actorId : current.approvedByUserId,
      promotedByUserId: transition.status === "PROMOTED" ? transition.actorId : current.promotedByUserId,
      rejectedByUserId: transition.status === "REJECTED" ? transition.actorId : current.rejectedByUserId,
      revokedByUserId: transition.status === "REVOKED" ? transition.actorId : current.revokedByUserId,
      approvedAt: transition.status === "APPROVED" ? transition.updatedAt : current.approvedAt,
      promotedAt: transition.status === "PROMOTED" ? transition.updatedAt : current.promotedAt,
      rejectedAt: transition.status === "REJECTED" ? transition.updatedAt : current.rejectedAt,
      revokedAt: transition.status === "REVOKED" ? transition.updatedAt : current.revokedAt,
    };
    this.auditActions.push(audit.action);
    return this.candidate;
  }

  peek(id: string): AgentLearningCandidate | null {
    return this.candidate?.id === id ? this.candidate : null;
  }
}

function trusted(profile: LearningAgentEvalCase["input"]["contextProfile"]): TrustedRequestContext {
  const all: PermissionKey[] = ["agent.chat", "review.decide", "prompt.activate"];
  return {
    subjectId: "demo-user-001",
    displayName: "Демо-пользователь",
    activeRoleAssignmentIds: ["assignment-learning-eval"],
    globalRoleKeys: [],
    activeProjectId: profile === "NO_PROJECT" ? null : "demo-project-001",
    projectRoleKeys: ["PROJECT_MANAGER"],
    permissionKeys: new Set(profile === "NO_CHAT" ? all.filter((item) => item !== "agent.chat") : all),
    catalogScopeIds: ["demo-catalog-001"],
    sourceScopeIds: ["demo-sap-001", "demo-normative-001"],
    accessClaims: {},
    authorizationVersion: 7,
    requestId: "request-learning-eval",
  };
}

function validApproval(id: string) {
  return {
    applicability: { equipmentType: "PIPE", datasetVersion: "1.0.0-DEMO" },
    regressionCaseId: `regression-${id}`,
    validationChecksum: "a".repeat(64),
    validationSummary: "Проверено на regression и held-out наборах.",
  };
}

function fixedNow(): Date {
  return new Date("2026-08-13T17:00:00.000Z");
}

function errorCode(error: unknown): string {
  if (error instanceof AgentLearningError) return error.code;
  if (error instanceof AuthorizationError) return `AUTHORIZATION_${error.permission}`;
  return error instanceof Error ? error.name : "UNKNOWN_ERROR";
}

function countBy<T>(values: readonly T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[key(value)] = (counts[key(value)] ?? 0) + 1;
  return counts;
}

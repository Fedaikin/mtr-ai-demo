import type { TrustedRequestContext } from "@/application/authorization-service";
import {
  AgentFeedbackService,
  AgentLearningCurationService,
  type AgentLearningAuditEnvelope,
  type AgentLearningStore,
  type AgentLearningSubmission,
  type AgentLearningTransition,
} from "@/application/agent-orchestrator/learning-service";
import type { AgentLearningCandidate } from "@/domain/agent/learning";

vi.mock("server-only", () => ({}));

describe("curated agent learning lifecycle", () => {
  it("creates an idempotent quarantined candidate without changing runtime behavior", async () => {
    const store = new MemoryLearningStore();
    const service = new AgentFeedbackService(store, fixedNow);
    const context = trusted(["agent.chat"]);

    const first = await service.submit({
      responseMessageId: "message-assistant-1",
      feedbackKind: "INCORRECT_FORECAST",
      summary: "Проверьте token=private-value и прогноз.",
    }, context);
    const replay = await service.submit({
      responseMessageId: "message-assistant-1",
      feedbackKind: "USEFUL",
    }, context);

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      feedbackKind: "INCORRECT_FORECAST",
      status: "QUARANTINED",
    });
    expect(store.items).toHaveLength(1);
    expect(store.items[0]).toMatchObject({
      status: "QUARANTINED",
      sanitizedSummary: "Проверьте token=[СКРЫТО] и прогноз.",
    });
    expect(store.audits.map((audit) => audit.action)).toEqual(["agent.feedback.submitted"]);
  });

  it("requires reviewed applicability, regression case and checksum before promotion", async () => {
    const store = new MemoryLearningStore();
    const feedback = new AgentFeedbackService(store, fixedNow);
    const curator = new AgentLearningCurationService(store, fixedNow);
    const owner = trusted(["agent.chat"]);
    const candidateId = (await feedback.submit({
      responseMessageId: "message-assistant-2",
      feedbackKind: "MISSING_FACTOR",
    }, owner)).candidateId;

    await expect(curator.promote(candidateId, trusted(["prompt.activate"]))).rejects.toMatchObject({
      code: "AGENT_LEARNING_INVALID_STATE",
    });
    await expect(curator.approve(candidateId, {
      applicability: { equipmentTypes: ["PIPE"] },
      regressionCaseId: "regression-learning-1",
      validationChecksum: "bad",
      validationSummary: "Проверено",
    }, trusted(["review.decide"]))).rejects.toMatchObject({
      code: "AGENT_FEEDBACK_VALIDATION_ERROR",
    });

    const approved = await curator.approve(candidateId, {
      applicability: { equipmentTypes: ["PIPE"] },
      regressionCaseId: "regression-learning-1",
      validationChecksum: "a".repeat(64),
      validationSummary: "Regression и held-out проверки пройдены.",
    }, trusted(["review.decide"]));
    expect(approved.status).toBe("APPROVED");

    const promoted = await curator.promote(candidateId, trusted(["prompt.activate"]));
    expect(promoted).toMatchObject({
      status: "PROMOTED",
      regressionCaseId: "regression-learning-1",
      validationChecksum: "a".repeat(64),
    });
    expect(store.audits.map((audit) => audit.action)).toEqual([
      "agent.feedback.submitted",
      "agent.learning.approved",
      "agent.learning.promoted",
    ]);
  });

  it("supports audited rollback and fails closed across project scope", async () => {
    const store = new MemoryLearningStore();
    const feedback = new AgentFeedbackService(store, fixedNow);
    const curator = new AgentLearningCurationService(store, fixedNow);
    const id = (await feedback.submit({
      responseMessageId: "message-assistant-3",
      feedbackKind: "UNSAFE_ACTION",
    }, trusted(["agent.chat"]))).candidateId;

    await expect(curator.approve(id, {
      applicability: { projectId: "demo-project-001" },
      regressionCaseId: "regression-learning-2",
      validationChecksum: "b".repeat(64),
      validationSummary: "Проверено.",
    }, { ...trusted(["review.decide"]), activeProjectId: "foreign-project" }))
      .rejects.toMatchObject({ code: "AGENT_FEEDBACK_ACCESS_DENIED" });

    await curator.approve(id, {
      applicability: { projectId: "demo-project-001" },
      regressionCaseId: "regression-learning-2",
      validationChecksum: "b".repeat(64),
      validationSummary: "Проверено.",
    }, trusted(["review.decide"]));
    await curator.promote(id, trusted(["prompt.activate"]));
    const revoked = await curator.revoke(id, "Выявлена регрессия.", trusted(["prompt.activate"]));

    expect(revoked.status).toBe("REVOKED");
    expect(store.audits.at(-1)?.action).toBe("agent.learning.revoked");
  });
});

class MemoryLearningStore implements AgentLearningStore {
  readonly items: AgentLearningCandidate[] = [];
  readonly audits: AgentLearningAuditEnvelope[] = [];

  async submitWithAudit(
    input: AgentLearningSubmission,
    audit: AgentLearningAuditEnvelope,
  ): Promise<AgentLearningCandidate> {
    const existing = this.items.find((item) => item.idempotencyKey === input.idempotencyKey);
    if (existing) return existing;
    const candidate: AgentLearningCandidate = {
      ...input,
      caseId: null,
      status: "QUARANTINED",
      sourcePromptVersion: "3.0.0",
      sourceModelVersion: "deterministic-runtime-v1",
      sourceRuleVersions: ["semantic-registry-1.0.0"],
      sourceEvidenceVersion: "evidence-1",
      applicability: null,
      regressionCaseId: null,
      validationChecksum: null,
      validationSummary: null,
      approvedByUserId: null,
      promotedByUserId: null,
      rejectedByUserId: null,
      revokedByUserId: null,
      updatedAt: input.createdAt,
      approvedAt: null,
      promotedAt: null,
      rejectedAt: null,
      revokedAt: null,
      version: 1,
    };
    this.items.push(candidate);
    this.audits.push(audit);
    return candidate;
  }

  async getForProject(id: string, projectId: string): Promise<AgentLearningCandidate | null> {
    return this.items.find((item) => item.id === id && item.projectId === projectId) ?? null;
  }

  async transitionWithAudit(
    id: string,
    projectId: string,
    version: number,
    transition: AgentLearningTransition,
    audit: AgentLearningAuditEnvelope,
  ): Promise<AgentLearningCandidate> {
    const index = this.items.findIndex((item) => item.id === id && item.projectId === projectId);
    const current = this.items[index];
    if (!current || current.version !== version || !transition.expectedStatuses.includes(current.status)) {
      throw Object.assign(new Error("conflict"), { code: "AGENT_LEARNING_CONFLICT" });
    }
    const updated: AgentLearningCandidate = {
      ...current,
      status: transition.status,
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
      updatedAt: transition.updatedAt,
      version: current.version + 1,
    };
    this.items[index] = updated;
    this.audits.push(audit);
    return updated;
  }
}

function trusted(permissions: string[]): TrustedRequestContext {
  return {
    subjectId: "demo-user-001",
    displayName: "Аналитик",
    activeRoleAssignmentIds: ["assignment-demo"],
    globalRoleKeys: [],
    activeProjectId: "demo-project-001",
    projectRoleKeys: ["PROJECT_MANAGER"],
    permissionKeys: new Set(permissions as TrustedRequestContext["permissionKeys"] extends ReadonlySet<infer T> ? T[] : never),
    catalogScopeIds: ["demo-catalog-001"],
    sourceScopeIds: ["demo-sap-001", "demo-normative-001"],
    accessClaims: {},
    authorizationVersion: 1,
    requestId: "request-learning-1",
  };
}

function fixedNow(): Date {
  return new Date("2026-08-13T16:00:00.000Z");
}

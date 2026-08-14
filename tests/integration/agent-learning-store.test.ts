import { eq } from "drizzle-orm";

import {
  DEFAULT_AGENT_LEARNING_TENANT_ID,
  PostgresAgentLearningStore,
} from "@/adapters/persistence/agent-learning-store";
import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase, getDatabase, type Database } from "@/adapters/persistence/db";
import {
  agentLearningCandidates,
  agentMessages,
  auditLogs,
} from "@/adapters/persistence/schema";
import type { TrustedRequestContext } from "@/application/authorization-service";
import {
  AgentFeedbackService,
  AgentLearningCurationService,
} from "@/application/agent-orchestrator/learning-service";
import { DEMO_USER_ID } from "@/domain/models";

vi.mock("server-only", () => ({}));

describe.sequential("durable agent feedback quarantine", () => {
  let db: Database;
  let assistantMessageId: string;

  beforeAll(async () => {
    await resetDemoDatabase(DEMO_USER_ID);
    db = await getDatabase();
    const repository = (await import("@/adapters/persistence/repository")).createRepository(db);
    const thread = await repository.createAgentThread(DEMO_USER_ID, "Feedback test", "thread-learning-1");
    const saved = await repository.appendAgentMessage(DEMO_USER_ID, {
      id: "message-learning-assistant-1",
      threadId: thread.id,
      role: "assistant",
      content: "Проверяемый ответ",
      promptVersion: "3.0.0",
      structuredOutput: {
        learningProvenance: {
          projectId: "demo-project-001",
          caseId: null,
          modelVersion: "deterministic-runtime-v1",
          ruleVersions: ["semantic-registry-1.0.0"],
          evidenceVersion: "evidence-graph-v1",
        },
      },
    });
    assistantMessageId = saved.message.id;
  });

  afterAll(async () => closeDatabase());

  it("atomically stores owner feedback and audit once", async () => {
    const store = new PostgresAgentLearningStore(db);
    const service = new AgentFeedbackService(store, fixedNow);
    const input = {
      responseMessageId: assistantMessageId,
      feedbackKind: "INCORRECT_CAUSE" as const,
      summary: "Причина не учитывает поставку.",
    };

    const first = await service.submit(input, context(["agent.chat"]));
    const replay = await service.submit({ ...input, feedbackKind: "USEFUL" }, context(["agent.chat"]));

    expect(replay).toEqual(first);
    const candidates = await db
      .select()
      .from(agentLearningCandidates)
      .where(eq(agentLearningCandidates.responseMessageId, assistantMessageId));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      tenantId: DEFAULT_AGENT_LEARNING_TENANT_ID,
      ownerUserId: DEMO_USER_ID,
      feedbackKind: "INCORRECT_CAUSE",
      status: "QUARANTINED",
      sourcePromptVersion: "3.0.0",
      sourceModelVersion: "deterministic-runtime-v1",
      sourceEvidenceVersion: "evidence-graph-v1",
    });
    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, first.candidateId));
    expect(audits.map((audit) => audit.action)).toEqual(["agent.feedback.submitted"]);
  });

  it("rejects foreign or user-authored message before persistence", async () => {
    const [assistant] = await db.select().from(agentMessages).where(eq(agentMessages.id, assistantMessageId));
    if (!assistant) throw new Error("Expected assistant message");
    await db.insert(agentMessages).values({
      id: "message-learning-user-1",
      threadId: assistant.threadId,
      userId: DEMO_USER_ID,
      role: "user",
      content: "Пользовательское сообщение",
      createdBy: DEMO_USER_ID,
    });
    const service = new AgentFeedbackService(new PostgresAgentLearningStore(db), fixedNow);

    await expect(service.submit({
      responseMessageId: "message-learning-user-1",
      feedbackKind: "USEFUL",
    }, context(["agent.chat"]))).rejects.toMatchObject({
      code: "AGENT_FEEDBACK_ACCESS_DENIED",
    });
  });

  it("rejects feedback after switching away from the response project", async () => {
    const service = new AgentFeedbackService(new PostgresAgentLearningStore(db), fixedNow);

    await expect(service.submit({
      responseMessageId: assistantMessageId,
      feedbackKind: "USEFUL",
    }, context(["agent.chat"], "foreign-project"))).rejects.toMatchObject({
      code: "AGENT_FEEDBACK_ACCESS_DENIED",
    });
  });

  it("persists approval, promotion and rollback with immutable validation provenance", async () => {
    const store = new PostgresAgentLearningStore(db);
    const feedback = new AgentFeedbackService(store, fixedNow);
    const curator = new AgentLearningCurationService(store, fixedNow);
    const responseMessageId = "message-learning-assistant-2";
    const [thread] = await db.select().from(agentMessages).where(eq(agentMessages.id, assistantMessageId));
    if (!thread) throw new Error("Expected assistant message");
    await db.insert(agentMessages).values({
      id: responseMessageId,
      threadId: thread.threadId,
      userId: DEMO_USER_ID,
      role: "assistant",
      content: "Второй ответ",
      promptVersion: "3.0.0",
      structuredOutput: {
        learningProvenance: {
          projectId: "demo-project-001",
          caseId: null,
          modelVersion: "deterministic-runtime-v1",
          ruleVersions: [],
          evidenceVersion: "evidence-graph-v2",
        },
      },
      createdBy: DEMO_USER_ID,
    });
    const id = (await feedback.submit({
      responseMessageId,
      feedbackKind: "MISSING_SOURCE",
    }, context(["agent.chat"]))).candidateId;

    await curator.approve(id, {
      applicability: { equipmentType: "PIPE" },
      regressionCaseId: "learning-regression-db-1",
      validationChecksum: "c".repeat(64),
      validationSummary: "Проверено на regression и held-out.",
    }, context(["review.decide"]));
    await curator.promote(id, context(["prompt.activate"]));
    const revoked = await curator.revoke(id, "Регрессия после активации.", context(["prompt.activate"]));

    expect(revoked).toMatchObject({
      status: "REVOKED",
      regressionCaseId: "learning-regression-db-1",
      validationChecksum: "c".repeat(64),
    });
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.entityId, id));
    expect(audits.map((audit) => audit.action)).toEqual([
      "agent.feedback.submitted",
      "agent.learning.approved",
      "agent.learning.promoted",
      "agent.learning.revoked",
    ]);
  });
});

function context(
  permissions: TrustedRequestContext["permissionKeys"] extends ReadonlySet<infer T> ? T[] : never,
  activeProjectId = "demo-project-001",
): TrustedRequestContext {
  return {
    subjectId: DEMO_USER_ID,
    displayName: "Демо-пользователь",
    activeRoleAssignmentIds: ["assign-demo-manager"],
    globalRoleKeys: [],
    activeProjectId,
    projectRoleKeys: ["PROJECT_MANAGER"],
    permissionKeys: new Set(permissions),
    catalogScopeIds: ["demo-catalog-001"],
    sourceScopeIds: ["demo-sap-001", "demo-normative-001"],
    accessClaims: {},
    authorizationVersion: 1,
    requestId: "request-learning-db",
  };
}

function fixedNow(): Date {
  return new Date("2026-08-13T16:00:00.000Z");
}

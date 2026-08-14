import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { getRepository } from "@/adapters/persistence/repository";
import {
  agentActionProposals,
  agentEventInbox,
  agentProactiveInsights,
} from "@/adapters/persistence/schema";
import { DEMO_USER_ID } from "@/domain/models";

vi.mock("server-only", () => ({}));

const NOW = "2026-08-13T12:00:00.000Z";
const RETENTION = "2027-08-13T12:00:00.000Z";

describe.sequential("persisted orchestrator observability", () => {
  beforeAll(async () => resetDemoDatabase(DEMO_USER_ID));
  afterAll(async () => closeDatabase());

  it("считает команды, планы, действия и сигналы без чтения их содержимого", async () => {
    const repository = await getRepository();
    await repository.writeAudit(DEMO_USER_ID, {
      action: "agent.command.received",
      entityType: "agent_command",
      entityId: "RISKS",
      outcome: "SUCCESS",
      requestId: "metrics-command-1",
      details: { commandKey: "RISKS" },
    });
    await repository.writeAudit(DEMO_USER_ID, {
      action: "agent.command.completed",
      entityType: "agent_command",
      entityId: "RISKS",
      outcome: "SUCCESS",
      requestId: "metrics-command-1",
      details: {
        durationMs: 120,
        citationCount: 0,
        missingDataCount: 2,
        requiresHumanReview: true,
      },
    });
    await repository.writeAudit(DEMO_USER_ID, {
      action: "agent.command.received",
      entityType: "agent_command",
      entityId: "STOCKS",
      outcome: "SUCCESS",
      requestId: "metrics-command-2",
      details: { commandKey: "STOCKS" },
    });
    await repository.writeAudit(DEMO_USER_ID, {
      action: "agent.command.failed",
      entityType: "agent_command",
      entityId: "STOCKS",
      outcome: "FAILURE",
      requestId: "metrics-command-2",
      details: { durationMs: 80, errorCode: "WAREHOUSE_SCOPE_DENIED" },
    });

    const plan = await repository.startAgentCommandPlan(DEMO_USER_ID, {
      projectId: "demo-project-001",
      commandKey: "RISKS",
      correlationId: "metrics-plan-1",
      selection: { projectId: "demo-project-001" },
      actorDisplayName: "Демо-пользователь 1",
      authorizationVersion: 1,
      roleAssignmentSnapshot: ["assign-demo-manager"],
      occurredAt: NOW,
    });

    const db = await getDatabase({ migrations: "skip" });
    await db.insert(agentActionProposals).values({
      id: "metrics-action-1",
      tenantId: "demo-tenant-001",
      projectId: "demo-project-001",
      caseId: plan.caseId,
      planExecutionId: plan.id,
      proposedByUserId: DEMO_USER_ID,
      actionType: "RUN_SCENARIO",
      status: "PROPOSED",
      resourceDescriptor: { resourceType: "SCENARIO_TEMPLATE", resourceId: "scenario-full" },
      requiredPermission: "analysis.create",
      summary: "Подготовить запуск",
      consequences: ["Будет создан черновик"],
      parameters: {},
      idempotencyKey: "metrics-action-1",
      authorizationVersion: 1,
      roleAssignmentSnapshot: ["assign-demo-manager"],
      proposedAt: NOW,
      expiresAt: "2026-08-13T12:30:00.000Z",
      correlationId: "metrics-action-1",
      createdAt: NOW,
      updatedAt: NOW,
      retentionUntil: RETENTION,
    });
    await db.insert(agentProactiveInsights).values({
      id: "metrics-insight-1",
      tenantId: "demo-tenant-001",
      projectId: "demo-project-001",
      subjectUserId: DEMO_USER_ID,
      triggerType: "RISK_LEVEL_RAISED",
      stateVersion: "risk-v1",
      level: "HIGH",
      status: "ACTIVE",
      targetType: "MATERIAL",
      targetId: "MAT-001",
      title: "Риск дефицита",
      summary: "Нужна проверка",
      recommendedAction: "Проверить остатки",
      evidenceFactIds: [],
      deduplicationKey: "metrics-insight-1",
      ruleVersion: "risk-rule-v1",
      authorizationVersion: 1,
      roleAssignmentSnapshot: ["assign-demo-manager"],
      createdAt: NOW,
      updatedAt: NOW,
      retentionUntil: RETENTION,
    });
    await db.insert(agentEventInbox).values({
      id: "metrics-event-1",
      tenantId: "demo-tenant-001",
      projectId: "demo-project-001",
      actorUserId: DEMO_USER_ID,
      sourceSystem: "SAP",
      sourceEventId: "metrics-source-event-1",
      eventType: "SAP_SNAPSHOT_RECEIVED",
      payload: {},
      status: "FAILED",
      attempts: 1,
      maxAttempts: 5,
      safeErrorCode: "SOURCE_UNAVAILABLE",
      correlationId: "metrics-event-1",
      idempotencyKey: "metrics-event-1",
      authorizationVersion: 1,
      roleAssignmentSnapshot: ["assign-demo-manager"],
      createdAt: NOW,
      updatedAt: NOW,
      retentionUntil: RETENTION,
    });

    await expect(repository.getAgentOrchestratorMetrics(DEMO_USER_ID)).resolves.toEqual({
      commandRequests: 2,
      commandSucceeded: 1,
      commandFailed: 1,
      commandPartial: 1,
      commandP50Ms: 120,
      commandP95Ms: 120,
      noCitationResponses: 1,
      humanReviewResponses: 1,
      staleOrConflictFailures: 0,
      rbacDenials: 1,
      activePlans: 1,
      stuckPlans: 1,
      succeededPlans: 0,
      failedPlans: 0,
      planP95Ms: null,
      actionsProposed: 1,
      actionsExecuting: 0,
      actionsSucceeded: 0,
      actionsFailed: 0,
      actionsCancelled: 0,
      actionsExpired: 0,
      activeInsights: 1,
      failedEvents: 1,
    });
  });
});

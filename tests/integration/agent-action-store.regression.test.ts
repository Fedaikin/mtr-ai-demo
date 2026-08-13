import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_AGENT_TENANT_ID,
  PostgresAgentActionStore,
} from "@/adapters/persistence/agent-action-store";
import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase, getDatabase, type Database } from "@/adapters/persistence/db";
import { agentCases, auditLogs } from "@/adapters/persistence/schema";
import {
  AgentActionService,
  type AgentActionExecutor,
} from "@/application/agent-orchestrator/action-service";
import type { TrustedRequestContext } from "@/application/authorization-service";
import { DEMO_USER_ID } from "@/domain/models";

vi.mock("server-only", () => ({}));

describe.sequential("durable L2 action store", () => {
  let db: Database;

  beforeAll(async () => {
    await resetDemoDatabase(DEMO_USER_ID);
    db = await getDatabase();
    await db.insert(agentCases).values({
      id: "case-action-1",
      tenantId: DEFAULT_AGENT_TENANT_ID,
      projectId: "demo-project-001",
      ownerUserId: DEMO_USER_ID,
      status: "READY",
      title: "Кейс для безопасного действия",
      contextSnapshot: { specificationId: "spec-demo-piping-001" },
      authorizationVersion: 1,
      roleAssignmentSnapshot: ["assign-demo-manager"],
      createdByUserId: DEMO_USER_ID,
      createdAt: "2026-08-13T12:00:00.000Z",
      updatedAt: "2026-08-13T12:00:00.000Z",
      retentionUntil: "2027-08-13T12:00:00.000Z",
    });
  });

  afterAll(async () => closeDatabase());

  it("атомарно сохраняет proposal/confirm/completion audit и не повторяет side effect", async () => {
    const execute = vi.fn(async () => ({
      resourceType: "SCENARIO_RUN",
      resourceId: "run-draft-1",
      status: "ACCEPTED" as const,
      safeSummary: "Черновик запуска подготовлен",
      link: "/runs/run-draft-1",
    }));
    const executor: AgentActionExecutor = {
      async resolveCurrent(proposal) {
        return proposal.resource;
      },
      execute,
    };
    const service = new AgentActionService(
      new PostgresAgentActionStore(db),
      executor,
      () => new Date("2026-08-13T12:00:00.000Z"),
    );
    const context = trustedContext();
    const input = {
      caseId: "case-action-1",
      actionType: "RUN_SCENARIO" as const,
      resource: {
        resourceType: "SCENARIO_TEMPLATE",
        resourceId: "scenario-full",
        projectId: "demo-project-001",
        ownerUserId: DEMO_USER_ID,
        status: "AVAILABLE",
      },
      summary: "Запустить анализ",
      consequences: ["Будет создан один новый запуск"],
      parameters: { specificationId: "spec-demo-piping-001", token: "must-be-redacted" },
      requestKey: "run-spec-demo-piping-001",
    };

    const proposed = await service.propose(input, context);
    const sameProposal = await service.propose(input, context);
    const completed = await service.confirm(proposed.id, context);
    const replay = await service.confirm(proposed.id, context);

    expect(sameProposal.id).toBe(proposed.id);
    expect(completed).toMatchObject({ status: "SUCCEEDED" });
    expect(replay).toEqual(completed);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(proposed.parameters).toEqual({ specificationId: "spec-demo-piping-001" });

    const actionAudits = (await db.select().from(auditLogs).where(eq(auditLogs.entityId, proposed.id)))
      .map((row) => ({ action: row.action, details: row.details }));
    expect(actionAudits.map((row) => row.action).sort()).toEqual([
      "agent.action.completed",
      "agent.action.confirmed",
      "agent.action.proposed",
    ]);
    expect(JSON.stringify(actionAudits)).not.toContain("must-be-redacted");
  });
});

function trustedContext(): TrustedRequestContext {
  return {
    subjectId: DEMO_USER_ID,
    displayName: "Демо-пользователь",
    activeRoleAssignmentIds: ["assign-demo-manager"],
    globalRoleKeys: [],
    activeProjectId: "demo-project-001",
    projectRoleKeys: ["PROJECT_MANAGER"],
    permissionKeys: new Set(["agent.chat", "analysis.create"]),
    catalogScopeIds: ["demo-catalog-001"],
    sourceScopeIds: ["demo-sap-001"],
    accessClaims: {},
    authorizationVersion: 1,
    requestId: "request-action-1",
  };
}

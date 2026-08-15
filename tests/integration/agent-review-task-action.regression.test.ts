import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { PostgresAgentActionStore } from "@/adapters/persistence/agent-action-store";
import { createAnalysisReviewDecisionReadPort } from "@/adapters/persistence/agent-task-port";
import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase, getDatabase, type Database } from "@/adapters/persistence/db";
import { getRepository, type MtrRepository } from "@/adapters/persistence/repository";
import { agentCases, agentTasks, auditLogs } from "@/adapters/persistence/schema";
import { PlatformAgentActionExecutor } from "@/application/agent-orchestrator/action-executor";
import { AgentActionService } from "@/application/agent-orchestrator/action-service";
import { AgentTaskService } from "@/application/agent-orchestrator/task-service";
import { resolveAuthorizationContext } from "@/application/authorization-service";
import { ScenarioService } from "@/application/scenario-service";
import { createAgentExecutionContext } from "@/domain/agent/context";
import { DEMO_USER_ID } from "@/domain/models";

vi.mock("server-only", () => ({}));

describe.sequential("confirmed expert-review task action", () => {
  let database: Database;
  let repository: MtrRepository;

  beforeAll(async () => {
    await resetDemoDatabase(DEMO_USER_ID);
    database = await getDatabase();
    repository = await getRepository();
  });

  afterAll(async () => closeDatabase());

  it("после confirm создаёт ровно одно durable задание реальному MTR_EXPERT и показывает его в MY_TASKS", async () => {
    const run = await new ScenarioService(repository).createRun(DEMO_USER_ID, {
      scenarioId: "scenario-full-analysis",
      mode: "NORMAL",
      seed: "BASE",
    });
    await database.insert(agentCases).values({
      id: "case-review-task-action-1",
      tenantId: "demo-tenant-001",
      projectId: "demo-project-001",
      ownerUserId: DEMO_USER_ID,
      status: "READY",
      title: "Кейс для экспертного задания",
      contextSnapshot: { runId: run.id },
      authorizationVersion: 1,
      roleAssignmentSnapshot: ["assign-demo-manager"],
      createdByUserId: DEMO_USER_ID,
      createdAt: "2026-08-13T12:00:00.000Z",
      updatedAt: "2026-08-13T12:00:00.000Z",
      retentionUntil: "2027-08-13T12:00:00.000Z",
    });
    const manager = await resolveAuthorizationContext(DEMO_USER_ID, "demo-project-001");
    const service = new AgentActionService(
      new PostgresAgentActionStore(database),
      new PlatformAgentActionExecutor(repository, { scheduleScenarioRun: () => undefined }),
      () => new Date("2026-08-13T12:05:00.000Z"),
    );
    const proposed = await service.propose({
      caseId: "case-review-task-action-1",
      actionType: "CREATE_REVIEW_TASK",
      resource: {
        resourceType: "SCENARIO_RUN",
        resourceId: run.id,
        projectId: "demo-project-001",
        ownerUserId: DEMO_USER_ID,
        status: run.status,
      },
      summary: "Проверить результат анализа",
      consequences: ["Эксперту будет назначено отдельное задание"],
      parameters: {
        assigneeUserId: "demo-expert-001",
        priority: "HIGH",
        dueAt: "2026-08-15T12:00:00.000Z",
      },
      requestKey: "create-review-task-1",
    }, manager);

    const completed = await service.confirm(proposed.id, manager);
    const replay = await service.confirm(proposed.id, manager);

    expect(completed).toMatchObject({
      status: "SUCCEEDED",
      result: {
        resourceType: "AGENT_TASK",
        status: "ACCEPTED",
        safeSummary: "Экспертное задание создано",
      },
    });
    expect(replay).toEqual(completed);
    const rows = await database.select().from(agentTasks);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      projectId: "demo-project-001",
      caseId: "case-review-task-action-1",
      assigneeUserId: "demo-expert-001",
      assignedByUserId: DEMO_USER_ID,
      kind: "EXPERT_REVIEW",
      status: "AWAITING_ACCEPTANCE",
      priority: "HIGH",
      resourceId: run.id,
    });

    const expert = await resolveAuthorizationContext("demo-expert-001", "demo-project-001");
    const snapshot = await new AgentTaskService(
      createAnalysisReviewDecisionReadPort(repository),
    ).listPersonal(createAgentExecutionContext(expert, {
      selection: { projectId: "demo-project-001" },
    }));
    expect(snapshot.tasks).toEqual([
      expect.objectContaining({
        id: rows[0]!.id,
        kind: "EXPERT_REVIEW",
        status: "AWAITING_ACCEPTANCE",
        priority: "HIGH",
        href: `/mtr-analysis?task=${encodeURIComponent(rows[0]!.id)}`,
      }),
    ]);

    const taskAudits = await database.select().from(auditLogs).where(eq(auditLogs.entityId, rows[0]!.id));
    expect(taskAudits).toEqual([
      expect.objectContaining({ action: "agent.task.created", outcome: "SUCCESS" }),
    ]);
    await expect(repository.findActiveProjectExpert(
      DEMO_USER_ID,
      "demo-project-001",
      "demo-viewer-001",
    )).resolves.toBeNull();
  });
});

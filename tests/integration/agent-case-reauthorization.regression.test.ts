import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { sql } from "drizzle-orm";

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { getRepository } from "@/adapters/persistence/repository";
import { loadAuthorizedScenarioCase } from "@/application/agent-orchestrator/case-access";
import type { TrustedRequestContext } from "@/application/authorization-service";
import { DEMO_USER_ID } from "@/domain/models";

describe.sequential("повторная авторизация case МТР-агента", () => {
  beforeEach(async () => {
    await resetDemoDatabase(DEMO_USER_ID);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("фильтрует запуск по активному проекту до публичной проекции", async () => {
    const repository = await getRepository();
    const run = await repository.createRun(DEMO_USER_ID, {
      id: "run-agent-case-scope",
      scenarioId: "scenario-full-analysis",
      specificationId: "spec-demo-piping-001",
      projectId: "demo-project-001",
    });

    await expect(loadAuthorizedScenarioCase(repository, context("demo-project-001"), run.id))
      .resolves.toMatchObject({ id: run.id, projectId: "demo-project-001" });
    await expect(loadAuthorizedScenarioCase(repository, context("other-project"), run.id))
      .resolves.toBeNull();
  });

  it("не раскрывает запуск после переноса ресурса в другой проект", async () => {
    const repository = await getRepository();
    const database = await getDatabase();
    await database.execute(sql`
      insert into projects (id, code, name, status, created_by)
      values ('other-project', 'OTHER', 'Другой проект', 'ACTIVE', ${DEMO_USER_ID})
      on conflict (id) do nothing
    `);
    const run = await repository.createRun(DEMO_USER_ID, {
      id: "run-agent-case-revoked",
      scenarioId: "scenario-full-analysis",
      specificationId: "spec-demo-piping-001",
      projectId: "demo-project-001",
    });
    await database.execute(sql`
      update scenario_runs set project_id = 'other-project' where id = ${run.id}
    `);

    await expect(loadAuthorizedScenarioCase(repository, context("demo-project-001"), run.id))
      .resolves.toBeNull();
  });
});

function context(activeProjectId: string): TrustedRequestContext {
  return {
    subjectId: DEMO_USER_ID,
    displayName: "Демо-пользователь 1",
    activeRoleAssignmentIds: ["assignment-test"],
    globalRoleKeys: [],
    activeProjectId,
    projectRoleKeys: ["MTR_ANALYST"],
    permissionKeys: new Set(["agent.chat", "analysis.read"]),
    catalogScopeIds: ["demo-catalog-001"],
    sourceScopeIds: ["demo-sap-001"],
    accessClaims: {},
    authorizationVersion: 7,
    requestId: "request-case-test",
  };
}

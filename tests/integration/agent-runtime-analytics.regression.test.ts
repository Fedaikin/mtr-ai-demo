import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { count, gt } from "drizzle-orm";

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { getRepository } from "@/adapters/persistence/repository";
import { agentMetricEvents, materialMovements } from "@/adapters/persistence/schema";
import type { TrustedRequestContext } from "@/application/authorization-service";
import { RuntimeAgentAnalyticsService } from "@/application/agent-orchestrator/runtime-analytics-service";
import { createAgentExecutionContext } from "@/domain/agent/context";
import { DEMO_USER_ID } from "@/domain/models";

vi.mock("server-only", () => ({}));

describe.sequential("persisted runtime KPI and risks", () => {
  beforeEach(async () => {
    await resetDemoDatabase(DEMO_USER_ID);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("seed содержит 12 недель движений и versioned process events", async () => {
    const database = await getDatabase();
    const [[movements], [events]] = await Promise.all([
      database.select({ value: count() }).from(materialMovements),
      database.select({ value: count() }).from(agentMetricEvents),
    ]);

    expect(movements!.value).toBe(30 * 12);
    expect(events!.value).toBe(12 * 3);
  });

  it("не строит числовой прогноз на истории короче восьми полных недель", async () => {
    const database = await getDatabase();
    await database.delete(materialMovements).where(
      gt(materialMovements.occurredAt, "2026-06-29T00:00:00.000Z"),
    );
    const context = executionContext();
    const result = await new RuntimeAgentAnalyticsService(
      await getRepository(),
      () => new Date("2026-08-13T12:00:00.000Z"),
    ).evaluateRisks(context, {
      selection: validatedSelection(),
      objectTypes: ["MATERIAL"],
      horizonDays: 90,
    });

    expect(result.items).toEqual([]);
    expect(result.evidence).toMatchObject({ availability: "UNAVAILABLE", confidence: 0 });
    expect(result.evidence.missingData).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "RISK_MOVEMENT_HISTORY_INSUFFICIENT" })]),
    );
  });
});

function executionContext() {
  return createAgentExecutionContext(trusted(), {
    selection: { projectId: "demo-project-001" },
    warehouseScopeIds: ["WH-DEMO-NORTH"],
  });
}

function validatedSelection() {
  return {
    projectId: "demo-project-001",
    validatedSubjectId: DEMO_USER_ID,
    validatedAgainstAuthorizationVersion: 1,
    validationRequestId: "request-runtime-analytics",
  } as const;
}

function trusted(): TrustedRequestContext {
  return {
    subjectId: DEMO_USER_ID,
    displayName: "Демо-пользователь",
    activeRoleAssignmentIds: ["assign-demo-manager"],
    globalRoleKeys: ["SYSTEM_ADMIN"],
    activeProjectId: "demo-project-001",
    projectRoleKeys: ["PROJECT_MANAGER"],
    permissionKeys: new Set(["agent.chat", "project.read", "analysis.read", "stock.search"]),
    catalogScopeIds: ["demo-catalog-001"],
    sourceScopeIds: ["demo-sap-001"],
    accessClaims: { warehouseIds: ["WH-DEMO-NORTH"] },
    authorizationVersion: 1,
    requestId: "request-runtime-analytics",
  };
}

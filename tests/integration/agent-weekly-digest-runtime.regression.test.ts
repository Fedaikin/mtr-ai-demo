import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { PersistenceWeeklyDigestSourcePort } from "@/adapters/persistence/agent-digest-port";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { agentMetricEvents, specificationVersions } from "@/adapters/persistence/schema";
import type { TrustedRequestContext } from "@/application/authorization-service";
import { createAgentExecutionContext } from "@/domain/agent/context";
import { DEMO_USER_ID } from "@/domain/models";

vi.mock("server-only", () => ({}));

describe.sequential("runtime source недельной сводки", () => {
  beforeAll(async () => {
    await resetDemoDatabase(DEMO_USER_ID);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("читает проектные версии и persisted KPI, не принимая чужой subject", async () => {
    const database = await getDatabase();
    const version = (await database.select().from(specificationVersions).limit(1))[0]!;
    await database.update(specificationVersions).set({
      updatedAt: "2026-08-10T10:00:00.000Z",
    }).where(eq(specificationVersions.id, version.id));
    await database.insert(agentMetricEvents).values({
      id: "metric-digest-1",
      tenantId: "demo-tenant-001",
      projectId: "demo-project-001",
      actorUserId: DEMO_USER_ID,
      eventType: "ANALYSIS_COMPLETED",
      eventVersion: 1,
      aggregateType: "RUN",
      aggregateId: "run-digest-1",
      occurredAt: "2026-08-11T10:00:00.000Z",
      correlationId: "digest-correlation-1",
      sourceVersion: "scenario-run-v1",
      attributes: {
        scope: "PERSONAL",
        label: "Доля завершённых проверок",
        currentValue: 80,
        previousValue: 70,
        unit: "%",
        subjectId: DEMO_USER_ID,
        metricSnapshot: true,
      },
      idempotencyKey: "digest-metric-1",
      authorizationVersion: 1,
      roleAssignmentSnapshot: ["assignment-demo-analyst"],
      ingestedAt: "2026-08-11T10:00:00.000Z",
      retentionUntil: "2027-08-11T10:00:00.000Z",
    });

    const context = createAgentExecutionContext(trusted(), {
      selection: { projectId: "demo-project-001" },
    });
    const source = await new PersistenceWeeklyDigestSourcePort(database).read(context, {
      projectId: "demo-project-001",
      subjectId: DEMO_USER_ID,
      period: { from: "2026-08-09T00:00:00.000Z", to: "2026-08-12T00:00:00.000Z", timezone: "Europe/Moscow" },
      previousPeriod: { from: "2026-08-02T00:00:00.000Z", to: "2026-08-09T00:00:00.000Z", timezone: "Europe/Moscow" },
    });

    expect(source.sources).toMatchObject({
      specifications: { availability: "COMPLETE", complete: true },
      positions: { availability: "COMPLETE", complete: true },
      kpi: { availability: "COMPLETE", complete: true },
    });
    expect(source.specificationChanges).toEqual([
      expect.objectContaining({ specificationId: version.specificationId, occurredAt: "2026-08-10T10:00:00.000Z" }),
    ]);
    expect(source.kpiChanges).toEqual([
      expect.objectContaining({ id: "metric-digest-1", currentValue: 80, previousValue: 70 }),
    ]);

    await expect(new PersistenceWeeklyDigestSourcePort(database).read(context, {
      projectId: "demo-project-001",
      subjectId: "foreign-user",
      period: { from: "2026-08-09T00:00:00.000Z", to: "2026-08-12T00:00:00.000Z", timezone: "Europe/Moscow" },
      previousPeriod: { from: "2026-08-02T00:00:00.000Z", to: "2026-08-09T00:00:00.000Z", timezone: "Europe/Moscow" },
    })).rejects.toThrow("DIGEST_SCOPE_DENIED");
  });
});

function trusted(): TrustedRequestContext {
  return {
    subjectId: DEMO_USER_ID,
    displayName: "Демо-пользователь",
    activeRoleAssignmentIds: ["assignment-demo-analyst"],
    globalRoleKeys: [],
    activeProjectId: "demo-project-001",
    projectRoleKeys: ["MTR_ANALYST"],
    permissionKeys: new Set(["agent.chat", "project.read", "specification.read", "analysis.read", "review.read"]),
    catalogScopeIds: ["demo-catalog-001"],
    sourceScopeIds: ["demo-sap-001"],
    accessClaims: {},
    authorizationVersion: 1,
    requestId: "request-digest-1",
  };
}

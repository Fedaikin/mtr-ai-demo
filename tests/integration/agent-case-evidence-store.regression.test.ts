import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PostgresAgentCaseStore } from "@/adapters/persistence/agent-case-store";
import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { AgentCaseService } from "@/application/agent-orchestrator/case-service";
import type { TrustedRequestContext } from "@/application/authorization-service";
import { DEMO_USER_ID } from "@/domain/models";

vi.mock("server-only", () => ({}));

describe.sequential("durable case/evidence lifecycle", () => {
  let service: AgentCaseService;

  beforeAll(async () => {
    await resetDemoDatabase(DEMO_USER_ID);
    service = new AgentCaseService(
      new PostgresAgentCaseStore(await getDatabase()),
      () => new Date("2026-08-13T12:00:00.000Z"),
    );
  });

  afterAll(async () => closeDatabase());

  it("идемпотентно сохраняет case/evidence и повторно авторизует citation при чтении", async () => {
    const allowed = context();
    const created = await service.create(
      {
        title: "Проверка остатка позиции",
        contextSnapshot: { specificationId: "spec-demo-piping-001", positionId: "position-1" },
        requestKey: "check-position-1",
      },
      allowed,
    );
    const same = await service.create(
      {
        title: "Проверка остатка позиции",
        contextSnapshot: { specificationId: "spec-demo-piping-001", positionId: "position-1" },
        requestKey: "check-position-1",
      },
      allowed,
    );

    const factInput = {
      kind: "STOCK_SNAPSHOT",
      summary: "На разрешённом складе найден остаток",
      sourceSystem: "SAP" as const,
      entityId: "SAP-DEMO-0001:WH-DEMO-01",
      versionOrSnapshot: "2026-08-13T11:00:00.000Z",
      observedAt: "2026-08-13T12:00:00.000Z",
      sourceSnapshotAt: "2026-08-13T11:00:00.000Z",
      freshness: "FRESH" as const,
      payload: { availableQuantity: 12, token: "never-public" },
      accessAttributes: { sourceScopeId: "demo-sap-001", warehouseId: "WH-DEMO-01" },
    };
    const fact = await service.appendEvidence(created.id, factInput, allowed);
    const sameFact = await service.appendEvidence(created.id, factInput, allowed);
    const visible = await service.get(created.id, allowed);
    const revoked = await service.get(created.id, context({ sourceScopeIds: [], warehouseIds: [] }));
    const foreign = await service.get(created.id, context({ subjectId: "demo-analyst-001" }));

    expect(same.id).toBe(created.id);
    expect(sameFact.id).toBe(fact.id);
    expect(visible).toMatchObject({ revokedEvidenceCount: 0, evidence: [{ id: fact.id }] });
    expect(JSON.stringify(visible)).not.toContain("availableQuantity");
    expect(JSON.stringify(visible)).not.toContain("never-public");
    expect(revoked).toMatchObject({ evidence: [], revokedEvidenceCount: 1 });
    expect(foreign).toBeNull();
  });

  it("terminal CLOSED сохраняется и повторный close идемпотентен", async () => {
    const current = context();
    const created = await service.create({ title: "Закрываемый кейс", requestKey: "close-case" }, current);
    const closed = await service.close(created.id, current);
    const replay = await service.close(created.id, current);

    expect(closed.status).toBe("CLOSED");
    expect(replay).toEqual(closed);
  });
});

function context(
  patch: {
    readonly subjectId?: string;
    readonly sourceScopeIds?: readonly string[];
    readonly warehouseIds?: readonly string[];
  } = {},
): TrustedRequestContext {
  return {
    subjectId: patch.subjectId ?? DEMO_USER_ID,
    displayName: "Демо-пользователь",
    activeRoleAssignmentIds: ["assign-demo-manager"],
    globalRoleKeys: [],
    activeProjectId: "demo-project-001",
    projectRoleKeys: ["PROJECT_MANAGER"],
    permissionKeys: new Set([
      "agent.chat",
      "project.read",
      "analysis.read",
      "specification.read",
      "stock.search",
    ]),
    catalogScopeIds: ["demo-catalog-001"],
    sourceScopeIds: patch.sourceScopeIds ?? ["demo-sap-001"],
    accessClaims: { warehouseIds: patch.warehouseIds ?? ["WH-DEMO-01"] },
    authorizationVersion: 1,
    requestId: "request-case-1",
  };
}

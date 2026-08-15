import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { TrustedRequestContext } from "@/application/authorization-service";
import {
  reauthorizeSavedAgentCitations,
  type AgentCitationReadPort,
} from "@/application/agent-orchestrator/citation-authorization";

describe("saved agent citation reauthorization", () => {
  const getBusinessProjectInProject = vi.fn();
  const repository: AgentCitationReadPort = {
    getSpecification: vi.fn(),
    getPosition: vi.fn(),
    getSapMaterialStock: vi.fn(),
    getCatalogItemByCode: vi.fn(),
    getBusinessProjectInProject,
    getScenarioRunInProject: vi.fn(),
    listNormativeChunks: vi.fn(),
    listAgentMetricEvents: vi.fn(),
    listMaterialMovements: vi.fn(),
    listAnalysisReviewTasksInProject: vi.fn(),
    listAgentAssignedTasksInProject: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("оставляет SAP citation только при текущем permission, source и warehouse scope", async () => {
    vi.mocked(repository.getSapMaterialStock).mockResolvedValue([
      { storageLocation: "WH-1" } as Awaited<ReturnType<AgentCitationReadPort["getSapMaterialStock"]>>[number],
    ]);
    const citation = saved("SAP", "SAP-DEMO-0001");

    await expect(reauthorizeSavedAgentCitations(trusted(), repository, [citation]))
      .resolves.toEqual([citation]);
    await expect(reauthorizeSavedAgentCitations(
      trusted(new Set(["agent.chat"])),
      repository,
      [citation],
    )).resolves.toEqual([]);
  });

  it("скрывает run citation после потери project/resource access без existence leak", async () => {
    vi.mocked(repository.getScenarioRunInProject).mockResolvedValue(null);
    const citation = saved("REPORT", "run-foreign");

    await expect(reauthorizeSavedAgentCitations(trusted(), repository, [citation]))
      .resolves.toEqual([]);
    expect(repository.getScenarioRunInProject).toHaveBeenCalledWith(
      "subject-1",
      "project-1",
      "run-foreign",
    );
  });

  it("проверяет существование persisted process event в активном проекте", async () => {
    vi.mocked(repository.listAgentMetricEvents).mockResolvedValue([{ id: "event-1" }]);
    const readable = saved("PROCESS_ENGINE", "event-1");
    const missing = saved("PROCESS_ENGINE", "event-foreign");

    await expect(reauthorizeSavedAgentCitations(trusted(), repository, [readable, missing]))
      .resolves.toEqual([readable]);
  });

  it("проверяет persisted movement внутри текущего warehouse scope", async () => {
    vi.mocked(repository.listMaterialMovements).mockResolvedValue([{ id: "movement-1" }]);
    const readable = saved("SAP", "movement-1");
    const foreign = saved("SAP", "movement-foreign");

    await expect(reauthorizeSavedAgentCitations(trusted(), repository, [readable, foreign]))
      .resolves.toEqual([readable]);
    expect(repository.listMaterialMovements).toHaveBeenCalledTimes(1);
    expect(repository.listMaterialMovements).toHaveBeenCalledWith(
      "subject-1",
      expect.objectContaining({ projectId: "project-1", warehouseIds: ["WH-1"] }),
    );
  });

  it("повторно авторизует только существующий business-project в активном проекте", async () => {
    getBusinessProjectInProject.mockResolvedValue({ id: "business-project-1", accessProjectId: "project-1" });
    const citation = saved("APPIUS", "business-project-1");

    await expect(reauthorizeSavedAgentCitations(trusted(), repository, [citation]))
      .resolves.toEqual([citation]);
    expect(getBusinessProjectInProject).toHaveBeenCalledWith("subject-1", "project-1", "business-project-1");

    getBusinessProjectInProject.mockResolvedValue(null);
    await expect(reauthorizeSavedAgentCitations(trusted(), repository, [citation]))
      .resolves.toEqual([]);
  });

  it("fail-closed скрывает неизвестную source system", async () => {
    await expect(reauthorizeSavedAgentCitations(trusted(), repository, [saved("INTERNAL_TOOL", "secret")]))
      .resolves.toEqual([]);
  });
});

function saved(sourceSystem: string, entityId: string) {
  return { sourceSystem, entityId, versionOrSnapshot: "v1", clauseId: null };
}

function trusted(
  permissionKeys: TrustedRequestContext["permissionKeys"] = new Set([
    "agent.chat",
    "project.read",
    "specification.read",
    "stock.search",
    "catalog.read",
    "analysis.read",
    "report.read",
    "review.read",
  ]),
): TrustedRequestContext {
  return {
    subjectId: "subject-1",
    displayName: "Аналитик",
    activeRoleAssignmentIds: ["assignment-1"],
    globalRoleKeys: [],
    activeProjectId: "project-1",
    projectRoleKeys: ["MTR_ANALYST"],
    permissionKeys,
    catalogScopeIds: ["catalog-1"],
    sourceScopeIds: ["demo-sap-001", "demo-normative-001", "demo-system-config-001"],
    accessClaims: { warehouseIds: ["WH-1"] },
    authorizationVersion: 7,
    requestId: "request-1",
  };
}

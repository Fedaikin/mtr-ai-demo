import { describe, expect, it, vi } from "vitest";

import { generateIndustrialCatalogue } from "@/adapters/mock/fixtures/industrial-catalogue";
import type { TrustedRequestContext } from "@/application/authorization-service";
import {
  UniversalCapabilityError,
  type UniversalCapabilityAuditPort,
} from "@/application/agent-orchestrator/universal-chat/capability-registry";
import { createUniversalReadCapabilityRegistry } from "@/application/agent-orchestrator/universal-chat/read-capabilities";
import { createAgentExecutionContext, type AgentExecutionContext } from "@/domain/agent/context";
import {
  COMPATIBILITY_ENGINE_VERSION,
  evaluateTechnicalCompatibility,
} from "@/domain/agent/universal-chat/compatibility-engine";
import { resolveEntity } from "@/domain/agent/universal-chat/entity-resolution";
import {
  compareReliability,
  failureProbability,
} from "@/domain/agent/universal-chat/reliability-engine";
import type { UniversalAgentReadPort } from "@/ports/universal-agent";

vi.mock("server-only", () => ({}));

describe("universal read runtime domain gates", () => {
  it("регистрирует полный обязательный G2 read-контракт с явной политикой", () => {
    const registry = createUniversalReadCapabilityRegistry({} as UniversalAgentReadPort);
    expect(registry.keys()).toEqual([
      "analysis.compareScenarios",
      "analysis.forecast",
      "analysis.projectSummary",
      "analysis.reorderRecommendations",
      "analysis.replacementRecommendations",
      "analysis.rootCause",
      "catalog.getBom",
      "catalog.getSubstitutes",
      "compatibility.evaluate",
      "deadline.listUpcoming",
      "material.forecastExhaustion",
      "material.get",
      "material.getInbound",
      "material.getMovements",
      "material.getReservations",
      "material.getStock",
      "material.getWhereUsed",
      "material.search",
      "process.getQueue",
      "process.getRuns",
      "project.get",
      "project.getKpiSla",
      "project.getMaterialCoverage",
      "project.getRisks",
      "project.getState",
      "project.list",
      "project.listDeadlines",
      "project.listMaterials",
      "project.listSpecifications",
      "project.search",
      "reliability.compare",
      "specification.countReceived",
      "specification.getCurrentVersion",
      "specification.getPositions",
      "specification.getProcessingQueue",
      "specification.getSlaBreaches",
      "specification.getStatusBreakdown",
      "specification.getWhereUsed",
      "specification.search",
      "task.listMine",
      "task.listProject",
    ]);
    expect(registry.manifest()).toHaveLength(41);
    expect(registry.manifest()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "material.getStock",
        resourceScope: "CATALOG_SOURCE",
        completeness: "PORT_ENFORCED",
        freshness: "SOURCE_SNAPSHOT",
        citations: "REQUIRED_FOR_FACTS",
        timeoutMs: 5_000,
      }),
    ]));
  });

  it("разрешает проект по коду, alias и распространённой опечатке без внутреннего ID", () => {
    const projects = [
      {
        id: "business-project-1",
        code: "PROJECT-MTR-006",
        name: "Установка подготовки нефти",
        aliases: ["УПН", "установка подготовки нефтии"],
      },
      {
        id: "business-project-2",
        code: "PROJECT-MTR-007",
        name: "Насосная станция",
        aliases: ["НС-7"],
      },
    ];

    expect(resolveEntity("PROJECT-MTR-006", projects)).toMatchObject({
      kind: "RESOLVED",
      entity: { id: "business-project-1" },
      confidence: 1,
    });
    expect(resolveEntity("что происходит по УПН?", projects)).toMatchObject({
      kind: "RESOLVED",
      entity: { id: "business-project-1" },
    });
    expect(resolveEntity("установка подготовки нефтии", projects)).toMatchObject({
      kind: "RESOLVED",
      entity: { id: "business-project-1" },
    });
  });

  it("считает 100% только для квалифицированного семейства и запрещает decoy hard gate", () => {
    const catalogue = generateIndustrialCatalogue();
    const sample = catalogue.manifest.representative;
    const source = catalogue.items.find((item) => item.itemCode === sample.itemCode)!;
    const valid = catalogue.items.find((item) => item.itemCode === sample.compatibleItemCodes[0])!;
    const decoy = catalogue.items.find((item) => item.itemCode === sample.incompatibleDecoyCode)!;

    const accepted = evaluateTechnicalCompatibility({
      source: compatibilityItem(source.itemCode, source),
      candidate: compatibilityItem(valid.itemCode, valid),
      candidateAvailableQuantity: 80,
      requiredQuantity: 100,
      normativeBasis: `Квалифицированное семейство ${source.familyId}`,
    });
    expect(accepted).toMatchObject({
      technicalCompatibilityPercent: 100,
      quantityCoveragePercent: 80,
      verdict: "EXACT",
      requiresHumanReview: false,
      engineVersion: COMPATIBILITY_ENGINE_VERSION,
    });
    expect(accepted.scoreBreakdown.reduce((sum, item) => sum + item.awarded, 0)).toBe(100);

    const prohibited = evaluateTechnicalCompatibility({
      source: compatibilityItem(source.itemCode, source),
      candidate: compatibilityItem(decoy.itemCode, decoy),
      candidateAvailableQuantity: 100,
      requiredQuantity: 100,
      normativeBasis: "candidate-family-rule-v1",
    });
    expect(prohibited).toMatchObject({
      technicalCompatibilityPercent: 0,
      verdict: "PROHIBITED",
      requiresHumanReview: true,
    });
  });

  it("не смешивает совместимость и надёжность и считает экспоненциальный риск", () => {
    const baseline = reliability(12_000, 15);
    const candidate = reliability(20_000, 12);
    const result = compareReliability(baseline, candidate, 8_000);

    expect(result).toMatchObject({ verdict: "IMPROVES" });
    expect(result.relativeRiskReductionPercent).toBeGreaterThan(20);
    expect(result.baselineFailureProbability).toBeCloseTo(failureProbability(8_000, 12_000), 6);
    expect(compareReliability(baseline, null, 8_000)).toMatchObject({
      verdict: "INSUFFICIENT_DATA",
      relativeRiskReductionPercent: 0,
    });
  });

  it("запрещает stock capability до обращения к порту, если нет stock.search", async () => {
    const searchMaterials = vi.fn();
    const registry = createUniversalReadCapabilityRegistry({
      searchMaterials,
    } as unknown as UniversalAgentReadPort);
    const context = createAgentExecutionContext(trusted(new Set(["agent.chat", "catalog.read"])));

    await expect(registry.execute("material.getStock", context, {
      materialCode: "SAP-CATALOG-PIP-0001",
    })).rejects.toBeInstanceOf(UniversalCapabilityError);
    expect(searchMaterials).not.toHaveBeenCalled();
  });

  it("строгая capability schema отклоняет identity и неизвестные поля", async () => {
    const registry = createUniversalReadCapabilityRegistry({} as UniversalAgentReadPort);
    const context = createAgentExecutionContext(trusted(new Set(["agent.chat", "project.read"])));

    await expect(registry.execute("project.list", context, {
      limit: 10,
      subjectId: "forged-user",
    })).rejects.toThrow();
  });

  it("аудирует capability без raw запроса, tool payload и пользовательского текста", async () => {
    const writeAudit = vi.fn(async (
      _context: AgentExecutionContext,
      _event: Parameters<UniversalCapabilityAuditPort["write"]>[1],
    ) => {
      void _context;
      void _event;
    });
    const audit: UniversalCapabilityAuditPort = { write: writeAudit };
    const listProjects = vi.fn(async () => []);
    const registry = createUniversalReadCapabilityRegistry(
      { listProjects } as unknown as UniversalAgentReadPort,
      undefined,
      audit,
    );
    const context = createAgentExecutionContext(trusted(new Set(["agent.chat", "project.read"])));

    await registry.execute("project.list", context, { limit: 10 });

    expect(writeAudit).toHaveBeenCalledWith(context, {
      capabilityKey: "project.list",
      outcome: "SUCCESS",
      durationMs: expect.any(Number),
    });
    const persistedEvent = writeAudit.mock.calls[0]?.[1];
    expect(JSON.stringify(persistedEvent)).not.toContain("subjectId");
    expect(JSON.stringify(persistedEvent)).not.toContain("forged");
  });
});

function compatibilityItem(materialCode: string, item: ReturnType<typeof generateIndustrialCatalogue>["items"][number]) {
  return {
    materialCode,
    equipmentType: item.equipmentType,
    itemKind: item.itemKind,
    familyId: item.familyId,
    unit: item.unit,
    standard: item.standard,
    materialGrade: item.materialGrade,
    manufacturer: item.manufacturer,
    characteristics: item.characteristics,
    compatibilityStatus: item.characteristics.compatibilityStatus,
  };
}

function reliability(mtbfHours: number, supplyRiskPercent: number) {
  return {
    profileVersion: "reliability-profile-v1" as const,
    operatingHours: 8_000,
    mtbfHours,
    failureCount: 1,
    qualityRejectionCount: 0,
    supplyRiskPercent,
    observedAt: "2026-08-13T09:15:00.000Z",
    sourceEvidenceIds: ["reliability-history-1"],
  };
}

function trusted(permissionKeys: TrustedRequestContext["permissionKeys"]): TrustedRequestContext {
  return {
    subjectId: "demo-user-001",
    displayName: "Аналитик МТР",
    activeRoleAssignmentIds: ["assignment-1"],
    globalRoleKeys: [],
    activeProjectId: "demo-project-001",
    projectRoleKeys: ["MTR_ANALYST"],
    permissionKeys,
    catalogScopeIds: ["demo-catalog-001"],
    sourceScopeIds: ["demo-sap-001", "demo-normative-001", "demo-system-config-001"],
    accessClaims: { warehouseIds: ["WH-DEMO-NORTH", "WH-DEMO-SOUTH"] },
    authorizationVersion: 7,
    requestId: "request-universal-unit",
  };
}

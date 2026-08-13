import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase } from "@/adapters/persistence/db";
import {
  createAgentOrchestratorPersistencePorts,
} from "@/adapters/persistence/agent-orchestrator-ports";
import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { getRepository, type MtrRepository } from "@/adapters/persistence/repository";
import type { TrustedRequestContext } from "@/application/authorization-service";
import { AuditedAgentCommandCapability } from "@/application/agent-orchestrator/audited-command-capability";
import { createAgentCommandRegistry } from "@/application/agent-orchestrator/command-registry";
import { MtrAgentOrchestrator } from "@/application/agent-orchestrator/orchestrator";
import { createAgentExecutionContext } from "@/domain/agent/context";
import { DEMO_USER_ID } from "@/domain/models";

vi.mock("server-only", () => ({}));

describe.sequential("production-shaped persistence ports МТР-агента", () => {
  let repository: MtrRepository;
  let specificationId: string;
  let materialCode: string;
  let warehouseId: string;

  beforeAll(async () => {
    await resetDemoDatabase(DEMO_USER_ID);
    repository = await getRepository();
    specificationId = (await repository.listSpecifications(DEMO_USER_ID))[0]!.id;
    const material = (await repository.listSapMaterials(DEMO_USER_ID))[0]!;
    materialCode = material.materialCode;
    warehouseId = material.storageLocation;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("читает SUMMARY из repository и применяет validated selection", async () => {
    const registry = createAgentCommandRegistry(createAgentOrchestratorPersistencePorts(repository));
    const context = executionContext(specificationId, warehouseId);

    const result = await registry.execute(context, {
      commandKey: "SUMMARY",
      context: { projectId: "demo-project-001", specificationId },
    });

    expect(result.responseType).toBe("SUMMARY");
    expect(result.facts.length).toBeGreaterThan(0);
    expect(result.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceKind: "SPECIFICATION_VERSION", sourceSystem: "APPIUS" }),
      ]),
    );
  });

  it("возвращает только разрешённый склад и честно помечает отсутствующие stock dimensions", async () => {
    const registry = createAgentCommandRegistry(createAgentOrchestratorPersistencePorts(repository));
    const context = executionContext(specificationId, warehouseId);

    const result = await registry.execute(context, {
      commandKey: "STOCKS",
      context: { projectId: "demo-project-001", specificationId },
      filters: { materialCode, warehouseIds: [warehouseId] },
    });

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((item) => item.warehouseId === warehouseId)).toBe(true);
    expect(result.items[0]).toMatchObject({
      materialCode,
      reservedQuantity: null,
      quarantinedQuantity: null,
    });
    expect(result).toMatchObject({ requiresHumanReview: true, negativeEvidence: "NOT_EMPTY" });
    expect(result.missingData).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "STOCK_RESERVATION_DATA_UNAVAILABLE" }),
      ]),
    );
    expect(result.missingData).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "STOCK_WAREHOUSE_FILTER_POST_RETRIEVAL" }),
      ]),
    );
  });

  it("читает канонический task source и доказывает пустую личную очередь", async () => {
    const adapters = createAgentOrchestratorPersistencePorts(repository);
    const context = executionContext(specificationId, warehouseId);
    const result = await adapters.tasks.listMine(context, {
      selection: validatedSelection(specificationId),
      assigneeSubjectId: DEMO_USER_ID,
    });

    expect(result.items).toEqual([]);
    expect(result.evidence).toMatchObject({
      availability: "COMPLETE",
      confidence: 1,
      coverage: { complete: true },
    });
    expect(result.evidence.citations).toEqual([
      expect.objectContaining({ sourceKind: "TASK_RECORD", sourceSystem: "TASK_STORE" }),
    ]);
  });

  it("рассчитывает риск из 12-недельной persisted истории движений", async () => {
    const adapters = createAgentOrchestratorPersistencePorts(repository);
    const result = await adapters.risks.evaluate(executionContext(specificationId, warehouseId), {
      selection: validatedSelection(specificationId),
      objectTypes: ["MATERIAL"],
      horizonDays: 90,
    });

    expect(result.evidence).toMatchObject({ availability: "COMPLETE", coverage: { complete: true } });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]).toMatchObject({
      objectType: "MATERIAL",
      ruleVersion: "stock-exhaustion-forecast-v1",
      requiresHumanReview: true,
    });
    expect(result.items[0]!.factors.join(" ")).toContain("12 полных нед.");
    expect(result.evidence.citations).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceKind: "MATERIAL_MOVEMENT", sourceSystem: "SAP" })]),
    );
  });

  it("рассчитывает KPI из persisted process events и movements", async () => {
    const adapters = createAgentOrchestratorPersistencePorts(repository);
    const result = await adapters.metrics.calculate(executionContext(specificationId, warehouseId), {
      selection: validatedSelection(specificationId),
      metricKeys: ["ANALYSIS_COMPLETION_RATE", "STOCK_COVERAGE"],
      warehouseIds: [warehouseId],
    });

    expect(result.evidence).toMatchObject({ availability: "COMPLETE", coverage: { complete: true } });
    expect(result.metrics.map((metric) => metric.metricKey)).toEqual([
      "ANALYSIS_COMPLETION_RATE",
      "STOCK_COVERAGE",
    ]);
    expect(result.metrics.every((metric) => metric.definitionVersion && metric.formula)).toBe(true);
    expect(result.metrics.flatMap((metric) => metric.drillDown)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceKind: "PROCESS_EVENT" }),
        expect.objectContaining({ sourceKind: "MATERIAL_MOVEMENT" }),
        expect.objectContaining({ sourceKind: "DEFINITION" }),
      ]),
    );
  });

  it("выполняет естественный запрос через тот же registry и durable audit", async () => {
    const legacyRespond = vi.fn();
    const capability = new AuditedAgentCommandCapability(
      createAgentCommandRegistry(createAgentOrchestratorPersistencePorts(repository)),
      repository,
    );
    const orchestrator = new MtrAgentOrchestrator({ respond: legacyRespond }, capability);

    const result = await orchestrator.handle({
      kind: "CHAT",
      message: `Покажи остатки ${materialCode} на ${warehouseId}`,
      selection: { projectId: "demo-project-001", specificationId },
      correlationId: "natural-command-integration-1",
    }, trustedContext(warehouseId));

    expect(result).toMatchObject({
      kind: "COMMAND",
      output: { responseType: "STOCKS", items: [expect.objectContaining({ materialCode, warehouseId })] },
    });
    expect(legacyRespond).not.toHaveBeenCalled();
    const audit = await repository.listAuditLogs(DEMO_USER_ID, { limit: 100 });
    expect(audit.filter((entry) => entry.requestId === "natural-command-integration-1")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "agent.command.received", outcome: "SUCCESS" }),
        expect.objectContaining({ action: "agent.command.completed", outcome: "SUCCESS" }),
      ]),
    );
  });
});

function executionContext(specificationId: string, warehouseId: string) {
  return createAgentExecutionContext(trustedContext(warehouseId), {
    selection: { projectId: "demo-project-001", specificationId },
    warehouseScopeIds: [warehouseId],
    correlationId: "command-integration-1",
  });
}

function validatedSelection(specificationId: string) {
  return {
    projectId: "demo-project-001",
    specificationId,
    validatedSubjectId: DEMO_USER_ID,
    validatedAgainstAuthorizationVersion: 1,
    validationRequestId: "request-integration-1",
  } as const;
}

function trustedContext(warehouseId: string): TrustedRequestContext {
  return {
    subjectId: DEMO_USER_ID,
    displayName: "Демо-пользователь",
    activeRoleAssignmentIds: ["assignment-1"],
    globalRoleKeys: [],
    activeProjectId: "demo-project-001",
    projectRoleKeys: ["MTR_ANALYST"],
    permissionKeys: new Set([
      "agent.chat",
      "project.read",
      "review.read",
      "analysis.read",
      "stock.search",
    ]),
    catalogScopeIds: ["demo-catalog-001"],
    sourceScopeIds: ["demo-sap-001", "demo-system-config-001"],
    accessClaims: { warehouseIds: [warehouseId] },
    authorizationVersion: 1,
    requestId: "request-integration-1",
  };
}

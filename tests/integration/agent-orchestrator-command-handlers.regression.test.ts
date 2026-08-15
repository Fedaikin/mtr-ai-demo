import type { TrustedRequestContext } from "@/application/authorization-service";
import {
  createAgentCommandRegistry,
  AgentCommandExecutionError,
} from "@/application/agent-orchestrator/command-registry";
import { createAgentExecutionContext } from "@/domain/agent/context";
import type {
  AgentEvidence,
  AgentOrchestratorPorts,
  KpiMetric,
} from "@/ports/agent-orchestrator";

const PERIOD = {
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-08T00:00:00.000Z",
} as const;

function trusted(patch: Partial<TrustedRequestContext> = {}): TrustedRequestContext {
  return {
    subjectId: "user-1",
    displayName: "Аналитик",
    activeRoleAssignmentIds: ["assignment-1"],
    globalRoleKeys: [],
    activeProjectId: "project-1",
    projectRoleKeys: ["MTR_ANALYST"],
    permissionKeys: new Set([
      "agent.chat",
      "project.read",
      "analysis.read",
      "stock.search",
      "review.read",
    ]),
    catalogScopeIds: ["catalog-1"],
    sourceScopeIds: ["sap-1", "process-1", "telemetry-1"],
    accessClaims: { warehouseIds: ["WH-01", "WH-02"] },
    authorizationVersion: 7,
    requestId: "request-1",
    ...patch,
  };
}

function sourceEvidence(patch: Partial<AgentEvidence> = {}): AgentEvidence {
  return {
    availability: "COMPLETE",
    confidence: 0.9,
    coverage: {
      requestedScope: ["WH-01", "WH-02"],
      checkedScope: ["WH-01", "WH-02"],
      complete: true,
    },
    citations: [
      {
        sourceKind: "MATERIAL_MOVEMENT",
        sourceSystem: "SAP",
        entityId: "movement-1",
        sourceSnapshot: "sap-snapshot-42",
        observedAt: "2026-08-08T01:00:00.000Z",
      },
    ],
    missingData: [],
    ...patch,
  };
}

function ports(): AgentOrchestratorPorts {
  return {
    summary: {
      read: vi.fn(async () => ({
        facts: ["Сводка сформирована"],
        evidence: sourceEvidence(),
      })),
    },
    tasks: {
      listMine: vi.fn(async () => ({ items: [], evidence: sourceEvidence() })),
    },
    risks: {
      evaluate: vi.fn(async () => ({ items: [], evidence: sourceEvidence() })),
    },
    stocks: {
      search: vi.fn(async () => ({ items: [], evidence: sourceEvidence() })),
    },
    metrics: {
      calculate: vi.fn(async () => ({ metrics: [], evidence: sourceEvidence() })),
    },
  };
}

function executionContext() {
  return createAgentExecutionContext(trusted(), {
    selection: {
      projectId: "project-1",
      specificationId: "specification-1",
      positionId: "position-1",
      period: PERIOD,
    },
    warehouseScopeIds: ["WH-01", "WH-02"],
    correlationId: "correlation-1",
  });
}

describe("регрессионные контракты обработчиков быстрых команд", () => {
  it("передаёт в SUMMARY валидированные project/specification/position/period", async () => {
    const adapters = ports();
    const registry = createAgentCommandRegistry(adapters);

    await registry.execute(executionContext(), {
      commandKey: "SUMMARY",
      context: {
        projectId: "project-1",
        specificationId: "specification-1",
        positionId: "position-1",
        period: PERIOD,
      },
    });

    expect(adapters.summary.read).toHaveBeenCalledWith(
      expect.objectContaining({ trusted: expect.objectContaining({ authorizationVersion: 7 }) }),
      expect.objectContaining({
        selection: expect.objectContaining({
          projectId: "project-1",
          specificationId: "specification-1",
          positionId: "position-1",
          period: PERIOD,
          validatedAgainstAuthorizationVersion: 7,
        }),
      }),
    );
  });

  it("отклоняет невалидированную спецификацию до обращения к SUMMARY port", async () => {
    const adapters = ports();

    await expect(
      createAgentCommandRegistry(adapters).execute(executionContext(), {
        commandKey: "SUMMARY",
        context: { projectId: "project-1", specificationId: "specification-foreign" },
      }),
    ).rejects.toMatchObject({ code: "AGENT_SELECTION_STALE" });
    expect(adapters.summary.read).not.toHaveBeenCalled();
  });

  it("передаёт warehouseIds в STOCKS до обращения к порту", async () => {
    const adapters = ports();
    const registry = createAgentCommandRegistry(adapters);

    await registry.execute(executionContext(), {
      commandKey: "STOCKS",
      context: { projectId: "project-1" },
      filters: { query: "подшипник", warehouseIds: ["WH-02"] },
    });

    expect(adapters.stocks.search).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ query: "подшипник", warehouseIds: ["WH-02"] }),
    );
  });

  it("отклоняет склад вне доверенного scope до обращения к порту", async () => {
    const adapters = ports();
    const registry = createAgentCommandRegistry(adapters);

    await expect(
      registry.execute(executionContext(), {
        commandKey: "STOCKS",
        context: { projectId: "project-1" },
        filters: { warehouseIds: ["WH-CLOSED"] },
      }),
    ).rejects.toMatchObject({ code: "AGENT_WAREHOUSE_SCOPE_DENIED" });
    expect(adapters.stocks.search).not.toHaveBeenCalled();
  });

  it("помечает пустой остаток без citation как недоказанный", async () => {
    const adapters = ports();
    vi.mocked(adapters.stocks.search).mockResolvedValue({
      items: [],
      evidence: sourceEvidence({ citations: [] }),
    });

    const result = await createAgentCommandRegistry(adapters).execute(executionContext(), {
      commandKey: "STOCKS",
      context: { projectId: "project-1" },
      filters: { warehouseIds: ["WH-01", "WH-02"] },
    });

    expect(result).toMatchObject({
      responseType: "STOCKS",
      confidence: 0,
      requiresHumanReview: true,
      negativeEvidence: "UNPROVEN_EMPTY",
    });
  });

  it("не выпускает складскую строку вне запрошенной области даже при ошибке адаптера", async () => {
    const adapters = ports();
    vi.mocked(adapters.stocks.search).mockResolvedValue({
      items: [
        {
          materialCode: "MTR-1",
          warehouseId: "WH-01",
          availableQuantity: 4,
          reservedQuantity: 0,
          quarantinedQuantity: 0,
          unit: "шт",
          snapshotAt: "2026-08-08T00:00:00.000Z",
        },
        {
          materialCode: "MTR-CLOSED",
          warehouseId: "WH-02",
          availableQuantity: 99,
          reservedQuantity: 0,
          quarantinedQuantity: 0,
          unit: "шт",
          snapshotAt: "2026-08-08T00:00:00.000Z",
        },
      ],
      evidence: sourceEvidence(),
    });

    const result = await createAgentCommandRegistry(adapters).execute(executionContext(), {
      commandKey: "STOCKS",
      context: { projectId: "project-1" },
      filters: { warehouseIds: ["WH-01"] },
    });

    expect(result.items.map((item) => item.warehouseId)).toEqual(["WH-01"]);
    expect(result).toMatchObject({ confidence: 0.9, requiresHumanReview: true });
    expect(result.missingData).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "STOCK_SCOPE_MISMATCH" })]),
    );
  });

  it("передаёт RISKS level/object/horizon/period в production-shaped port", async () => {
    const adapters = ports();

    await createAgentCommandRegistry(adapters).execute(executionContext(), {
      commandKey: "RISKS",
      context: { projectId: "project-1", period: PERIOD },
      filters: {
        levels: ["HIGH", "CRITICAL"],
        objectTypes: ["MATERIAL", "TASK"],
        horizonDays: 30,
      },
    });

    expect(adapters.risks.evaluate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        levels: ["HIGH", "CRITICAL"],
        objectTypes: ["MATERIAL", "TASK"],
        horizonDays: 30,
        selection: expect.objectContaining({ period: PERIOD }),
      }),
    );
  });

  it("не заявляет об отсутствии рисков при неполном охвате", async () => {
    const adapters = ports();
    vi.mocked(adapters.risks.evaluate).mockResolvedValue({
      items: [],
      evidence: sourceEvidence({
        availability: "PARTIAL",
        confidence: 1,
        coverage: {
          requestedScope: ["position-1", "position-2"],
          checkedScope: ["position-1"],
          complete: false,
        },
        missingData: [{ code: "RISK_SCOPE_PARTIAL", message: "Проверена часть позиций" }],
      }),
    });

    const result = await createAgentCommandRegistry(adapters).execute(executionContext(), {
      commandKey: "RISKS",
      context: { projectId: "project-1", period: PERIOD },
      filters: { levels: ["HIGH"], horizonDays: 14 },
    });

    expect(result).toMatchObject({
      responseType: "RISKS",
      confidence: 0,
      requiresHumanReview: true,
      negativeEvidence: "UNPROVEN_EMPTY",
    });
    expect(result.summary).not.toMatch(/рисков нет|риски отсутствуют|не обнаружен/i);
  });

  it("сохраняет реальный source kind и source snapshot каждого KPI drill-down", async () => {
    const adapters = ports();
    const metric: KpiMetric = {
      metricKey: "STOCK_COVERAGE",
      definitionVersion: "metric-definition-v7",
      formula: "covered / required",
      period: PERIOD,
      numerator: 8,
      denominator: 10,
      value: 0.8,
      unit: "RATIO",
      target: 0.9,
      deviation: -0.1,
      trend: "DOWN",
      availability: "COMPLETE",
      drillDown: [
        {
          sourceKind: "MATERIAL_MOVEMENT",
          sourceSystem: "SAP",
          entityId: "movement-17",
          sourceSnapshot: "sap-snapshot-100",
          observedAt: "2026-08-05T10:00:00.000Z",
        },
        {
          sourceKind: "PROCESS_EVENT",
          sourceSystem: "PROCESS_ENGINE",
          entityId: "event-5",
          sourceSnapshot: "event-store-offset-55",
          observedAt: "2026-08-06T11:00:00.000Z",
        },
        {
          sourceKind: "TECHNICAL_SAMPLE",
          sourceSystem: "TELEMETRY",
          entityId: "sample-9",
          sourceSnapshot: "telemetry-window-12",
          observedAt: "2026-08-07T12:00:00.000Z",
        },
        {
          sourceKind: "DEFINITION",
          sourceSystem: "METRIC_REGISTRY",
          entityId: "definition-stock-coverage",
          sourceSnapshot: "registry-snapshot-3",
          observedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
    };
    vi.mocked(adapters.metrics.calculate).mockResolvedValue({
      metrics: [metric],
      evidence: sourceEvidence(),
    });

    const result = await createAgentCommandRegistry(adapters).execute(executionContext(), {
      commandKey: "KPI",
      context: { projectId: "project-1", period: PERIOD },
      filters: { metricKeys: ["STOCK_COVERAGE"] },
    });

    expect(adapters.metrics.calculate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metricKeys: ["STOCK_COVERAGE"],
        warehouseIds: ["WH-01", "WH-02"],
      }),
    );
    expect(result.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKind: "MATERIAL_MOVEMENT",
          sourceSnapshot: "sap-snapshot-100",
        }),
        expect.objectContaining({
          sourceKind: "PROCESS_EVENT",
          sourceSnapshot: "event-store-offset-55",
        }),
        expect.objectContaining({
          sourceKind: "TECHNICAL_SAMPLE",
          sourceSnapshot: "telemetry-window-12",
        }),
        expect.objectContaining({
          sourceKind: "DEFINITION",
          sourceSnapshot: "registry-snapshot-3",
        }),
      ]),
    );
    expect(result.metrics).toEqual([
      expect.objectContaining({ definitionVersion: "metric-definition-v7" }),
    ]);
    expect(result.citations.every((citation) => citation.sourceSnapshot !== metric.definitionVersion)).toBe(true);
  });

  it("не вызывает handler без обязательного permission", async () => {
    const adapters = ports();
    const context = createAgentExecutionContext(
      trusted({ permissionKeys: new Set(["agent.chat", "project.read"]) }),
      { selection: { projectId: "project-1" }, warehouseScopeIds: ["WH-01"] },
    );

    await expect(
      createAgentCommandRegistry(adapters).execute(context, {
        commandKey: "STOCKS",
        context: { projectId: "project-1" },
      }),
    ).rejects.toBeInstanceOf(AgentCommandExecutionError);
    expect(adapters.stocks.search).not.toHaveBeenCalled();
  });
});

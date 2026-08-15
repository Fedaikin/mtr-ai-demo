import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { generateUniversalChatDataset } from "@/adapters/mock/fixtures/universal-chat-dataset";
import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { seedIndustrialCatalogue } from "@/adapters/persistence/catalog-bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { MtrRepository } from "@/adapters/persistence/repository";
import { createUniversalAgentReadPort } from "@/adapters/persistence/universal-agent-read-port";
import { seedUniversalChatDataset } from "@/adapters/persistence/universal-chat-bootstrap";
import type { TrustedRequestContext } from "@/application/authorization-service";
import { createUniversalReadCapabilityRegistry } from "@/application/agent-orchestrator/universal-chat/read-capabilities";
import type { UniversalCapabilityRegistry } from "@/application/agent-orchestrator/universal-chat/capability-registry";
import { UniversalChatService } from "@/application/agent-orchestrator/universal-chat/universal-chat-service";
import { createAgentExecutionContext } from "@/domain/agent/context";
import { createFixedScenarioClock } from "@/domain/agent/universal-chat/scenario-clock";
import { DEMO_USER_ID } from "@/domain/models";

const CLOCK = createFixedScenarioClock("2026-08-13T09:15:00.000Z");
const dataset = generateUniversalChatDataset(CLOCK);
const PIPE_PROJECT_ID = dataset.manifest.referenceProjectIds.pipeRichProjectId;
const PIPE_PROJECT = dataset.businessProjects.find((project) => project.id === PIPE_PROJECT_ID)!;

describe.sequential("universal read capabilities on persisted universal-chat-v1", () => {
  let service: UniversalChatService;
  let registry: UniversalCapabilityRegistry;

  beforeAll(async () => {
    await closeDatabase();
    const database = await getDatabase({ migrations: "ensure" });
    await resetDemoDatabase(DEMO_USER_ID, database);
    await seedIndustrialCatalogue(DEMO_USER_ID, database);
    await seedUniversalChatDataset(DEMO_USER_ID, database, CLOCK);
    registry = createUniversalReadCapabilityRegistry(createUniversalAgentReadPort(database), CLOCK);
    service = new UniversalChatService(registry, CLOCK);
  }, 90_000);

  afterAll(async () => closeDatabase());

  test("разрешает фактическое название проекта и считает остаток труб по oracle", async () => {
    const output = await service.respond({
      message: `Какой остаток по трубам по проекту ${PIPE_PROJECT.name}?`,
    }, context());

    expect(output).not.toBeNull();
    expect(output).not.toHaveProperty("kind");
    if (!output || "kind" in output) throw new Error("expected universal answer");
    const pipePositions = dataset.positionLinks.filter(
      (position) => position.businessProjectId === PIPE_PROJECT_ID && position.equipmentType === "PIPE",
    );
    const pipeOracles = dataset.projectMaterialOracles.filter(
      (oracle) => oracle.businessProjectId === PIPE_PROJECT_ID &&
        pipePositions.some((position) => position.operationalMaterialCode === oracle.materialCode),
    );
    expect(output.resolvedContext.businessProject).toMatchObject({
      id: PIPE_PROJECT_ID,
      name: PIPE_PROJECT.name,
    });
    expect(output.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "positions", value: pipePositions.length }),
      expect.objectContaining({
        key: "shortages",
        value: pipeOracles.filter((oracle) => oracle.expected.shortageAtNeedDate > 0).length,
      }),
    ]));
    const firstOracle = pipeOracles[0];
    const row = output.tables[0]?.rows.find((candidate) =>
      String(candidate["Материал"]).includes(firstOracle.materialCode));
    expect(row).toMatchObject({
      "Потребность": firstOracle.expected.requiredAtNeedDate,
      "Доступно": firstOracle.expected.netAvailableNow,
      "К сроку": firstOracle.expected.netAvailableAtNeedDate,
      "Дефицит": firstOracle.expected.shortageAtNeedDate,
      "Дозаказ": firstOracle.expected.reorderQuantity,
    });
    expect(output.citations.length).toBeGreaterThan(1);
    expect(output.confidence).toBe(0.96);
  }, 30_000);

  test("понимает семантику intake сегодня и не трактует «упало» как ошибку без слова ошибка", async () => {
    const received = await service.respond({ message: "Сколько спецификаций упало сегодня?" }, context());
    const failed = await service.respond({ message: "Сколько спецификаций упало сегодня с ошибкой?" }, context());
    if (!received || "kind" in received || !failed || "kind" in failed) throw new Error("expected intake answer");

    const today = dataset.specificationIntakes.filter((item) => item.receivedAt.startsWith("2026-08-13"));
    expect(received.facts).toContainEqual(expect.objectContaining({ key: "received", value: today.length }));
    expect(failed.summary).toContain(`Сегодня с ошибкой: ${today.filter((item) => item.status === "FAILED").length}`);
  });

  test.each([
    ["Какие проекты под риском?", "risk-projects"],
    ["Какие проекты отстают по SLA?", "sla-breaches"],
    ["Какие решения ждут человека?", "human-decisions"],
  ])("даёт доказательную портфельную сводку: %s", async (message, factKey) => {
    const output = await service.respond({ message }, context());
    if (!output || "kind" in output) throw new Error("expected portfolio answer");
    expect(output.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: factKey, value: expect.any(Number) }),
    ]));
    expect(output.tables[0]?.totalRows).toBeGreaterThanOrEqual(0);
    expect(output.citations.length).toBeGreaterThan(0);
  });

  test("сохраняет безопасный проектный контекст в многошаговом вопросе и фильтрует purpose", async () => {
    const first = await service.respond({
      message: `Покажи дефицит по трубам проекта ${PIPE_PROJECT.code}`,
    }, context());
    if (!first || "kind" in first) throw new Error("expected project answer");
    const shortageCodes = first.risks.flatMap((risk) => risk.materialCode ? [risk.materialCode] : []);
    const second = await service.respond({
      message: "А какие из дефицитных можно заменить? Оставь только обслуживание.",
      memory: {
        resolvedContext: first.resolvedContext,
        shortageMaterialCodes: shortageCodes,
      },
    }, context());
    if (!second || "kind" in second) throw new Error("expected follow-up answer");

    expect(second.resolvedContext).toMatchObject({
      businessProject: { id: PIPE_PROJECT_ID },
      purpose: "MAINTENANCE",
    });
    expect(second.facts.find((fact) => fact.key === "active-specifications")?.value).toBe(
      dataset.specificationLinks.filter((link) => link.businessProjectId === PIPE_PROJECT_ID && link.purpose === "MAINTENANCE").length,
    );
  }, 30_000);

  test("находит сборочный узел по публичному каталожному коду и возвращает BOM", async () => {
    const assemblyCode = "CAT-DEMO-ASM-PIP-0001";
    const output = await service.respond({
      message: `Покажи состав сборочного узла ${assemblyCode}`,
    }, context());
    if (!output || "kind" in output) throw new Error("expected assembly answer");

    expect(output.resolvedContext.material?.code).toBe("SAP-CATALOG-ASM-PIP-0001");
    expect(output.tables.find((table) => table.id === "assembly-bom")).toMatchObject({
      totalRows: 6,
    });
  });

  test("сравнивает две явно названные детали, не подменяя вторую автоподбором", async () => {
    const source = dataset.operationalMaterials.find((material) => material.familyId)!;
    const candidate = dataset.operationalMaterials.find((material) =>
      material.familyId === source.familyId &&
      material.materialCode !== source.materialCode)!;
    const output = await service.respond({
      message: `На сколько процентов ${source.catalogItemCode} совместима с ${candidate.catalogItemCode} и почему?`,
    }, context());
    if (!output || "kind" in output) throw new Error("expected compatibility answer");

    expect(output.compatibility).toHaveLength(1);
    expect(output.compatibility[0]).toMatchObject({
      sourceMaterialCode: source.materialCode,
      candidateMaterialCode: candidate.materialCode,
      technicalCompatibilityPercent: expect.any(Number),
      scoreBreakdown: expect.any(Array),
    });
  });

  test("объясняет последнюю версию спецификации без требования внутреннего ID", async () => {
    const output = await service.respond({
      message: "Что изменилось в последней версии spec-demo-piping-001?",
    }, context());
    if (!output || "kind" in output) throw new Error("expected version answer");

    expect(output.resolvedContext.specification?.code).toBe("spec-demo-piping-001");
    expect(output.tables.find((table) => table.id === "specification-version-diff")?.totalRows).toBeGreaterThanOrEqual(2);
    expect(output.citations).toHaveLength(1);
  });

  test("не принимает неизвестный публичный код материала за запрос проекта", async () => {
    const output = await service.respond({
      message: "Что это за материал CAT-DEMO-NOT-9999?",
    }, context());
    if (!output || "kind" in output) throw new Error("expected honest material answer");

    expect(output).toMatchObject({ confidence: 0, requiresHumanReview: true });
    expect(output.missingData).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MATERIAL_NOT_FOUND" }),
    ]));
    expect(output.citations).toEqual([]);
  });

  test("строит портфельный прогноз исчерпания на фиксированном горизонте", async () => {
    const output = await service.respond({
      message: "Что закончится в ближайшие 30 дней?",
    }, context());
    if (!output || "kind" in output) throw new Error("expected forecast answer");

    expect(output.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "exhaustion-materials", value: expect.any(Number) }),
    ]));
    expect(output.tables.find((table) => table.id === "portfolio-exhaustion")).toBeDefined();
    expect(output.citations.length).toBeGreaterThan(0);
  }, 30_000);

  test("открывает process/task чтения только через typed scoped capabilities", async () => {
    await expect(registry.execute("process.getRuns", context(), { limit: 10 })).resolves.toEqual([]);
    await expect(registry.execute("task.listMine", context(), { limit: 10 })).resolves.toEqual([]);
    await expect(registry.execute("task.listProject", context(), {
      projectId: "demo-project-001",
      limit: 10,
    })).resolves.toEqual([]);
  });

  test("все запросы scoped к canonical access project до SQL", async () => {
    const foreign = context({ activeProjectId: "foreign-project" });
    const output = await service.respond({ message: "Покажи активные проекты" }, foreign);
    if (!output || "kind" in output) throw new Error("expected scoped empty answer");
    expect(output).toMatchObject({ confidence: 0, requiresHumanReview: true });
    expect(output.tables[0]).toMatchObject({ totalRows: 0, rows: [] });
    expect(output.citations).toEqual([]);
  });

  test("повторно авторизует бизнес-проект для участника, а не только создателя записи", async () => {
    const database = await getDatabase({ migrations: "skip" });
    const repository = new MtrRepository(database);

    await expect(repository.getBusinessProjectInProject(
      "demo-analyst-001",
      "demo-project-001",
      PIPE_PROJECT_ID,
    )).resolves.toEqual({ id: PIPE_PROJECT_ID, accessProjectId: "demo-project-001" });
  });

  test("складская проекция включает только разрешённые warehouseIds", async () => {
    const source = dataset.operationalMaterials.find((material) =>
      material.stock.balances.some((balance) => balance.warehouseId === "WH-DEMO-NORTH"))!;
    const trusted = context({
      accessClaims: { warehouseIds: ["WH-DEMO-NORTH"] },
    });
    const stock = await registry.execute("material.getStock", trusted, {
      materialCode: source.materialCode,
    }) as typeof source.stock;
    const expected = source.stock.balances
      .filter((balance) => balance.warehouseId === "WH-DEMO-NORTH")
      .reduce((total, balance) => total + balance.onHandQuantity, 0);

    expect(stock.onHandQuantity).toBe(expected);
    expect(stock.balances.every((balance) => balance.warehouseId === "WH-DEMO-NORTH")).toBe(true);
  });
});

function context(patch: Partial<TrustedRequestContext> = {}) {
  const trusted: TrustedRequestContext = {
    subjectId: DEMO_USER_ID,
    displayName: "Демо-пользователь 1",
    activeRoleAssignmentIds: ["assignment-demo-manager"],
    globalRoleKeys: [],
    activeProjectId: "demo-project-001",
    projectRoleKeys: ["PROJECT_MANAGER"],
    permissionKeys: new Set([
      "agent.chat",
      "project.read",
      "specification.read",
      "specification.history.read",
      "catalog.read",
      "catalog.substitutes.read",
      "catalog.bom.read",
      "stock.search",
      "analysis.read",
      "analysis.create",
      "review.read",
      "review.queue.read",
    ]),
    catalogScopeIds: ["demo-catalog-001"],
    sourceScopeIds: ["demo-sap-001", "demo-normative-001", "demo-system-config-001"],
    accessClaims: { warehouseIds: [
      "WH-DEMO-NORTH",
      "WH-DEMO-CENTRAL",
      "WH-DEMO-ELECTRICAL",
      "WH-DEMO-SOUTH",
      "WH-DEMO-INSTRUMENT",
      "WH-DEMO-EQUIPMENT",
      "WH-DEMO-RESERVE",
    ] },
    authorizationVersion: 1,
    requestId: "request-universal-integration",
    ...patch,
  };
  return createAgentExecutionContext(trusted);
}

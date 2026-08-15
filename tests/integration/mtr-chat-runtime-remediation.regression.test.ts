import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { seedIndustrialCatalogue } from "@/adapters/persistence/catalog-bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { createUniversalAgentReadPort } from "@/adapters/persistence/universal-agent-read-port";
import { seedUniversalChatDataset } from "@/adapters/persistence/universal-chat-bootstrap";
import { getRepository } from "@/adapters/persistence/repository";
import {
  resolveAuthorizationContext,
  type TrustedRequestContext,
} from "@/application/authorization-service";
import { createUniversalReadCapabilityRegistry } from "@/application/agent-orchestrator/universal-chat/read-capabilities";
import { UniversalCapabilityError } from "@/application/agent-orchestrator/universal-chat/capability-registry";
import { UniversalChatService } from "@/application/agent-orchestrator/universal-chat/universal-chat-service";
import { createMtrAgentOrchestrator } from "@/app/api/agent/_shared";
import { createAgentExecutionContext } from "@/domain/agent/context";
import { createFixedScenarioClock } from "@/domain/agent/universal-chat/scenario-clock";
import { DEMO_USER_ID } from "@/domain/models";

const CLOCK = createFixedScenarioClock("2026-08-13T09:15:00.000Z");

describe.sequential("corrective universal chat runtime", () => {
  let service: UniversalChatService;

  beforeAll(async () => {
    await closeDatabase();
    const database = await getDatabase({ migrations: "ensure" });
    await resetDemoDatabase(DEMO_USER_ID, database);
    await seedIndustrialCatalogue(DEMO_USER_ID, database);
    await seedUniversalChatDataset(DEMO_USER_ID, database, CLOCK);
    service = new UniversalChatService(
      createUniversalReadCapabilityRegistry(createUniversalAgentReadPort(database), CLOCK),
      CLOCK,
    );
  }, 90_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDatabase();
  });

  test("TC-CHAT-01 возвращает только ACTIVE проекты и фактические project IDs", async () => {
    const output = await service.respond({ message: "Покажи активные проекты" }, context());
    if (!output || "kind" in output) throw new Error("Ожидался структурированный ответ.");

    expect(output.tables[0]?.rows).toHaveLength(22);
    expect(output.tables[0]?.rows.every((row) => row["Статус"] === "Активен")).toBe(true);
    expect(output.summary).toBe("Доступно 22 активных бизнес-проекта.");
    expect(output.confidence).toBe(1);
    expect(output.requiresHumanReview).toBe(false);
  });

  test.each([
    "Что у нас сейчас в работе?",
    "Какие проекты сейчас активны?",
    "Перечисли текущие рабочие проекты",
    "Что из проектов находится в активной фазе?",
    "Над какими проектами мы сейчас работаем?",
    "Покажи проекты в работе",
    "Текущие рабочие проекты",
    "Какие проекты идут сейчас?",
    "Что сейчас активно по проектам?",
    "Дай список проектов, которые находятся в работе",
  ])("FG-02 распознаёт разговорный запрос активных проектов: %s", async (message) => {
    const output = await service.respond({ message }, context());
    if (!output || "kind" in output) throw new Error("Ожидался структурированный ответ.");

    expect(output.summary).toBe("Доступно 22 активных бизнес-проекта.");
    expect(output.tables[0]?.rows).toHaveLength(22);
    expect(output.tables[0]?.rows.every((row) => row["Статус"] === "Активен")).toBe(true);
  });

  test("FG-05 считает сегодняшнее поступление по полному status breakdown, даже если вопрос содержит очередь", async () => {
    const output = await service.respond({
      message: "Сколько спецификаций поступило сегодня, сколько обработано и что осталось в очереди?",
    }, context());
    if (!output || "kind" in output) throw new Error("Ожидался структурированный ответ.");

    expect(output.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "received", value: 12 }),
      expect.objectContaining({ key: "completed", value: 2 }),
      expect.objectContaining({ key: "pending", value: 8 }),
      expect.objectContaining({ key: "failed", value: 2 }),
    ]));
    expect(output.tables[0]?.totalRows).toBe(8);
  });

  test("FG-06 возвращает только незавершённые сроки в ближайшие три дня", async () => {
    const output = await service.respond({
      message: "Покажи доступные мне проекты и спецификации со сроком в ближайшие три дня и выдели риски",
    }, context());
    if (!output || "kind" in output) throw new Error("Ожидался структурированный ответ.");

    const rows = output.tables[0]?.rows ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => String(row["Спецификации"] ?? "").trim().length > 0)).toBe(true);
    expect(rows.every((row) => row["Статус"] !== "Выполнен")).toBe(true);
    expect(rows.every((row) => {
      const value = String(row["Срок"] ?? "");
      return /^(?:13|14|15|16)\s+авг\./u.test(value);
    })).toBe(true);
  });

  test.each([
    "Покажи дедлайны доступных проектов до конца трёхдневного горизонта",
    "Покажи дедлайны доступных проектов до конца трехдневного горизонта",
  ])("FG-06 распознаёт словесный трёхдневный горизонт: %s", async (message) => {
    const output = await service.respond({ message }, context());
    if (!output || "kind" in output) throw new Error("Ожидался структурированный ответ.");

    expect(output.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "deadline-count", value: expect.any(Number) }),
    ]));
    expect(output.tables[0]).toMatchObject({
      id: "upcoming-deadlines",
      columns: ["Проект", "Спецификации", "Событие", "Срок", "Статус"],
    });
  });

  test("FG-10 неизвестный безопасный код маршрутизируется в доказательный NOT_FOUND", async () => {
    const code = "ZX-A1B2C3D4E5F6";
    const output = await service.respond({ message: `Какой остаток и назначение у ${code}?` }, context());
    if (!output || "kind" in output) throw new Error("Ожидался структурированный ответ.");

    expect(output.confidence).toBe(0);
    expect(output.requiresHumanReview).toBe(true);
    expect(output.citations).toEqual([]);
    expect(output.missingData).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MATERIAL_NOT_FOUND" }),
    ]));
  });

  test("FG-09 фраза «работаем по проекту» выбирает один проект, а не весь активный портфель", async () => {
    const output = await service.respond({
      message: "Работаем по проекту PROJECT-MTR-013",
    }, context());
    if (!output || "kind" in output) throw new Error("Ожидался структурированный ответ.");

    expect(output.resolvedContext.businessProject?.code).toBe("PROJECT-MTR-013");
    expect(output.citations.filter((citation) => citation.entityId === output.resolvedContext.businessProject?.id))
      .toHaveLength(1);
  });

  test("TC-CHAT-04 использует material context потока и не выдумывает alias «второй склад»", async () => {
    const output = await service.respond({
      message: "Проверь этот шкаф на втором складе",
      memory: {
        resolvedContext: {
          material: {
            kind: "MATERIAL",
            id: "catalog-item-asm-elc-0001",
            code: "SAP-CATALOG-ASM-ELC-0001",
            name: "Шкаф управления электродвигателем № 0001",
            confidence: 1,
          },
        },
      },
    }, context());

    expect(output).toEqual({
      kind: "ASK_CLARIFICATION",
      question: "Уточните склад для материала «Шкаф управления электродвигателем № 0001».",
      candidates: [
        expect.objectContaining({ kind: "WAREHOUSE", code: "WH-DEMO-CENTRAL" }),
        expect.objectContaining({ kind: "WAREHOUSE", code: "WH-DEMO-SOUTH" }),
      ],
    });
  });

  test("TC-CHAT-03 выполняет frozen составной запрос как три независимых status scope", async () => {
    const output = await service.respond({
      message: "Покажи активные проекты; затем отдельно запланированные; затем все доступные проекты",
    }, context());
    if (!output || "kind" in output) throw new Error("Ожидался структурированный ответ.");

    expect(output.tables.map((table) => ({ id: table.id, count: table.totalRows }))).toEqual([
      { id: "active-projects", count: 22 },
      { id: "planned-projects", count: 0 },
      { id: "all-projects", count: 22 },
    ]);
    expect(new Set(output.citations.map((citation) => citation.entityId))).toEqual(
      new Set(datasetActiveProjectIds()),
    );
  });

  test("TC-CHAT-02 отвечает по точному объекту и явному разрешённому складу", async () => {
    const output = await service.respond({
      message: "Есть ли на WH-DEMO-CENTRAL шкаф управления электродвигателем № 0001?",
    }, context());
    if (!output || "kind" in output) throw new Error("Ожидался доказательный складской ответ.");

    expect(output.resolvedContext.material).toMatchObject({ code: "SAP-CATALOG-ASM-ELC-0001" });
    expect(output.summary).toContain("WH-DEMO-CENTRAL");
    expect(output.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "warehouse-on-hand", value: 4, unit: "EA" }),
    ]));
    expect(output.citations).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceSystem: "SAP", entityId: "SAP-CATALOG-ASM-ELC-0001" }),
    ]));
  });

  test("two-thread/two-scope: analyst receives stock while viewer gets a leak-free denial", async () => {
    vi.stubEnv("MTR_AGENT_ORCHESTRATOR_ENABLED", "true");
    vi.stubEnv("MTR_AGENT_UNIVERSAL_CHAT_ENABLED", "true");
    vi.stubEnv("MTR_AGENT_LIVE_LLM_ENABLED", "false");
    const repository = await getRepository();
    const [analystContext, viewerContext, analystThread, viewerThread] = await Promise.all([
      resolveAuthorizationContext("demo-analyst-001", "demo-project-001"),
      resolveAuthorizationContext("demo-viewer-001", "demo-project-001"),
      repository.createAgentThread("demo-analyst-001", "Аналитик: остаток"),
      repository.createAgentThread("demo-viewer-001", "Наблюдатель: остаток"),
    ]);
    const orchestrator = createMtrAgentOrchestrator(repository);
    const outcomes = await Promise.allSettled([
      orchestrator.handle({
        kind: "CHAT",
        threadId: analystThread.id,
        message: "Есть ли на WH-DEMO-CENTRAL шкаф управления электродвигателем № 0001?",
      }, analystContext),
      orchestrator.handle({
        kind: "CHAT",
        threadId: viewerThread.id,
        message: "Есть ли на WH-DEMO-CENTRAL шкаф управления электродвигателем № 0001?",
      }, viewerContext),
    ]);

    expect(outcomes[0]).toMatchObject({
      status: "fulfilled",
      value: {
        kind: "UNIVERSAL",
        output: {
          resolvedContext: { material: { code: "SAP-CATALOG-ASM-ELC-0001" } },
          facts: expect.arrayContaining([
            expect.objectContaining({ key: "warehouse-on-hand", value: 4, unit: "EA" }),
          ]),
        },
      },
    });
    expect(outcomes[1].status).toBe("rejected");
    if (outcomes[1].status !== "rejected") throw new Error("Viewer stock query must be rejected.");
    expect(outcomes[1].reason).toBeInstanceOf(UniversalCapabilityError);
    expect((outcomes[1].reason as UniversalCapabilityError).code).toBe("UNIVERSAL_CAPABILITY_FORBIDDEN");

    const [analystMessages, viewerMessages, viewerAudit] = await Promise.all([
      repository.listAgentMessages("demo-analyst-001", analystThread.id),
      repository.listAgentMessages("demo-viewer-001", viewerThread.id),
      repository.listAuditLogs("demo-viewer-001", { entityType: "AGENT_CAPABILITY", limit: 20 }),
    ]);
    expect(analystMessages).toEqual([]);
    expect(viewerMessages).toEqual([]);
    expect(viewerAudit).toEqual(expect.arrayContaining([
      expect.objectContaining({
        outcome: "FAILURE",
        details: expect.objectContaining({
          safeErrorCode: "UNIVERSAL_CAPABILITY_FORBIDDEN",
        }),
      }),
    ]));
    expect(JSON.stringify(viewerAudit)).not.toMatch(/SAP-CATALOG|WH-DEMO|Шкаф управления/iu);
  });
});

function context() {
  const trusted: TrustedRequestContext = {
    subjectId: DEMO_USER_ID,
    displayName: "Демо-пользователь 1",
    activeRoleAssignmentIds: ["assign-demo-manager"],
    globalRoleKeys: ["SYSTEM_ADMIN"],
    activeProjectId: "demo-project-001",
    projectRoleKeys: ["PROJECT_MANAGER"],
    permissionKeys: new Set([
      "agent.chat", "project.read", "specification.read", "specification.history.read",
      "catalog.read", "catalog.substitutes.read", "catalog.bom.read", "stock.search",
      "analysis.read", "analysis.create", "review.read", "review.queue.read",
    ]),
    catalogScopeIds: ["demo-catalog-001"],
    sourceScopeIds: ["demo-sap-001", "demo-normative-001", "demo-system-config-001"],
    accessClaims: { warehouseIds: [
      "WH-DEMO-NORTH", "WH-DEMO-CENTRAL", "WH-DEMO-ELECTRICAL", "WH-DEMO-SOUTH",
      "WH-DEMO-INSTRUMENT", "WH-DEMO-EQUIPMENT", "WH-DEMO-RESERVE",
    ] },
    authorizationVersion: 1,
    requestId: "request-corrective-chat",
  };
  return createAgentExecutionContext(trusted);
}

function datasetActiveProjectIds(): string[] {
  return [
    "business-project-pipe-rich-project-mtr-006-project-mtr-007",
    "business-project-project-project-demo-alpha",
    "business-project-project-project-demo-beta",
    "business-project-project-project-demo-gamma",
    ...Array.from({ length: 5 }, (_, index) =>
      `business-project-project-project-mtr-${String(index + 1).padStart(3, "0")}`),
    ...Array.from({ length: 13 }, (_, index) =>
      `business-project-project-project-mtr-${String(index + 8).padStart(3, "0")}`),
  ];
}

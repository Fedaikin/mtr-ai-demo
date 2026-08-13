import { describe, expect, it, vi } from "vitest";

import { MockLLMProvider } from "@/adapters/mock/mock-llm-provider";
import {
  createAgentService,
  type AgentServiceDependencies,
} from "@/application/agent-service";
import type {
  CatalogAssemblyBom,
  CatalogFamily,
  CatalogItem,
  CatalogItemWithStock,
  CatalogPort,
  CatalogSearchItem,
  CatalogSearchResult,
} from "@/ports";

const userId = "demo-user-001";
const snapshotAt = "2026-08-12T08:30:00.000Z";

describe("агент промышленного каталога", () => {
  it("маршрутизирует свободный текст в промышленный каталог", async () => {
    const found = catalogSearchItem("CAT-DEMO-3120", {
      nameRu: "Манометр технический",
      totalAvailableQuantity: 41,
    });
    const catalog = catalogPort({
      search: { items: [found], total: 1, limit: 20, offset: 0 },
    });
    const dependencies = agentDependencies(catalog);

    const output = await createAgentService(dependencies).respond(
      { message: "Найди в промышленном каталоге манометр" },
      userId,
    );

    expect(catalog.searchItems).toHaveBeenCalledWith(
      { text: "манометр", limit: 20, offset: 0 },
      userId,
    );
    expect(dependencies.sap.searchMaterialStock).not.toHaveBeenCalled();
    expect(output.answer).toContain("CAT-DEMO-3120");
  });

  it("находит дальнюю позицию по точному коду и показывает агрегированный остаток", async () => {
    const item = catalogItemWithStock("CAT-DEMO-4800", {
      totalAvailableQuantity: 137,
      balanceCount: 2,
    });
    const catalog = catalogPort({ item });
    const dependencies = agentDependencies(catalog);

    const output = await createAgentService(dependencies).respond(
      { message: "Какой суммарный остаток CAT-DEMO-4800?" },
      userId,
    );

    expect(catalog.getItemByCode).toHaveBeenCalledWith("CAT-DEMO-4800", userId);
    expect(catalog.searchItems).not.toHaveBeenCalled();
    expect(dependencies.sap.getState).not.toHaveBeenCalled();
    expect(output.answer).toContain("CAT-DEMO-4800");
    expect(output.answer).toContain("137");
    expect(output.answer).toContain("2 складским записям");
    expect(output.answer).not.toContain("catalog.getItemByCode");
    expect(output.citations).toContainEqual({
      sourceSystem: "CATALOG",
      entityId: "CAT-DEMO-4800",
      versionOrSnapshot: snapshotAt,
      clauseId: null,
    });
  });

  it("не принимает числовой суффикс каталожного кода за требуемое количество", async () => {
    const item = catalogItemWithStock("CAT-DEMO-PIP-0005", {
      totalAvailableQuantity: 8,
      balanceCount: 1,
    });
    const output = await createAgentService(agentDependencies(catalogPort({ item }))).respond(
      { message: "Нужно CAT-DEMO-PIP-0005 в количестве 10 шт." },
      userId,
    );

    expect(output.answer).toContain("потребности 10 шт.");
    expect(output.answer).toContain("не хватает 2 шт.");
    expect(output.answer).not.toContain("потребности 5 шт.");
  });

  it("исключает несовместимую контрольную позицию из списка замен", async () => {
    const source = catalogItemWithStock("CAT-DEMO-0001", {
      familyId: "family-001",
      totalAvailableQuantity: 4,
    });
    const compatible = catalogSearchItem("CAT-DEMO-0002", {
      familyId: "family-001",
      totalAvailableQuantity: 28,
    });
    const decoy = catalogSearchItem("CAT-DEMO-DECOY-0001", {
      familyId: "family-001",
      characteristics: {
        category: "VALVES",
        compatibilityStatus: "INCOMPATIBLE_DECOY",
      },
      fixtureTags: ["catalogue", "incompatible-decoy"],
      totalAvailableQuantity: 999,
    });
    const family = catalogFamily();
    const catalog = catalogPort({
      item: source,
      substitutes: {
        sourceItemCode: source.itemCode,
        family,
        items: [compatible, decoy],
      },
    });

    const output = await createAgentService(agentDependencies(catalog)).respond(
      { message: "Подбери взаимозаменяемые аналоги для CAT-DEMO-0001" },
      userId,
    );

    expect(output.answer).toContain("CAT-DEMO-0002");
    expect(output.answer).not.toContain("CAT-DEMO-DECOY-0001");
    expect(output.facts.join(" ")).toContain("контрольные позиции исключены");
    expect(output.requiresHumanReview).toBe(true);
  });

  it("возвращает состав сборочного узла с количеством и остатками компонентов", async () => {
    const assembly = catalogItemWithStock("CAT-DEMO-4321", {
      itemKind: "ASSEMBLY",
      familyId: undefined,
      characteristics: {
        category: "ROTATING",
        compatibilityStatus: "NOT_APPLICABLE",
      },
    });
    const bom: CatalogAssemblyBom = {
      assembly,
      components: Array.from({ length: 6 }, (_, index) => ({
        id: `bom-${String(index + 1).padStart(3, "0")}`,
        positionNumber: String((index + 1) * 10).padStart(3, "0"),
        quantity: index === 1 ? 4 : 2,
        unit: "шт.",
        isCritical: index === 0,
        component: catalogSearchItem(
          `CAT-DEMO-${String(101 + index).padStart(4, "0")}`,
          { totalAvailableQuantity: index === 1 ? 3 : 12 },
        ),
        alternativeFamily: index === 0 ? catalogFamily() : null,
      })),
    };
    const catalog = catalogPort({ item: assembly, bom });

    const output = await createAgentService(agentDependencies(catalog)).respond(
      { message: "Покажи состав узла CAT-DEMO-4321" },
      userId,
    );

    expect(catalog.getAssemblyBom).toHaveBeenCalledWith("CAT-DEMO-4321", userId);
    expect(output.answer).toContain("Состав узла CAT-DEMO-4321");
    expect(output.answer).toContain("CAT-DEMO-0101");
    expect(output.answer).toContain("допустимые замены: семейство");
    expect(output.answer).toContain("риск: критический компонент");
    expect(output.answer).toContain("2 шт.");
    expect(output.answer).toContain("CAT-DEMO-0102");
    expect(output.facts.join(" ")).toContain("6 компонентов");
    expect(output.recommendations.join(" ")).toContain("CAT-DEMO-0102");
    expect(output.citations.map((citation) => citation.entityId)).toEqual(
      expect.arrayContaining(["CAT-DEMO-4321", "CAT-DEMO-0101", "CAT-DEMO-0102"]),
    );
  });
});

function agentDependencies(catalog: CatalogPort): AgentServiceDependencies {
  return {
    catalog,
    appius: {
      listSpecifications: vi.fn(async () => []),
      listVersions: vi.fn(async () => []),
      getLatestVersion: vi.fn(async () => {
        throw new Error("unexpected Appius call");
      }),
      getPositions: vi.fn(async () => []),
      getState: vi.fn(async () => ({
        system: "APPIUS" as const,
        state: "AVAILABLE" as const,
        delayMs: 0,
      })),
    },
    sap: {
      searchMaterialStock: vi.fn(async () => ({
        items: [],
        total: 0,
        snapshotAt,
      })),
      getMaterialStock: vi.fn(async () => []),
      getState: vi.fn(async () => ({
        system: "SAP" as const,
        state: "AVAILABLE" as const,
        delayMs: 0,
      })),
    },
    norms: {
      searchResponsibilityRules: vi.fn(async () => []),
      searchAnalogueRules: vi.fn(async () => []),
    },
    scenarios: { getRun: vi.fn(async () => null) },
    reports: { getSummary: vi.fn(async () => null) },
    llm: new MockLLMProvider(),
    audit: { write: vi.fn(async () => undefined) },
  };
}

function catalogPort(options: {
  item?: CatalogItemWithStock | null;
  substitutes?: Awaited<ReturnType<CatalogPort["listSubstitutes"]>>;
  bom?: CatalogAssemblyBom | null;
  search?: CatalogSearchResult;
} = {}): CatalogPort {
  return {
    searchItems: vi.fn(async () =>
      options.search ?? { items: [], total: 0, limit: 20, offset: 0 },
    ),
    getItemByCode: vi.fn(async () => options.item ?? null),
    listSubstitutes: vi.fn(async () => options.substitutes ?? null),
    getAssemblyBom: vi.fn(async () => options.bom ?? null),
  };
}

function catalogFamily(): CatalogFamily {
  return {
    id: "family-001",
    code: "CAT-FAMILY-001",
    nameRu: "Краны шаровые DN 50 PN 16",
    equipmentType: "BALL_VALVE",
    itemKind: "COMPONENT",
    unit: "шт.",
    compatibilitySignature: { dn: 50, pn: 16 },
    active: true,
    isSyntheticDemo: true,
  };
}

function catalogItemWithStock(
  itemCode: string,
  patch: Partial<CatalogItemWithStock> = {},
): CatalogItemWithStock {
  return {
    ...catalogItem(itemCode),
    totalAvailableQuantity: 10,
    balanceCount: 1,
    latestSnapshotAt: snapshotAt,
    balances: [
      {
        id: `balance-${itemCode}`,
        plant: "PLANT-DEMO-01",
        storageLocation: "WH-DEMO-01",
        availableQuantity: 10,
        unit: "шт.",
        snapshotAt,
      },
    ],
    ...patch,
  };
}

function catalogSearchItem(
  itemCode: string,
  patch: Partial<CatalogSearchItem> = {},
): CatalogSearchItem {
  return {
    ...catalogItem(itemCode),
    totalAvailableQuantity: 10,
    balanceCount: 1,
    latestSnapshotAt: snapshotAt,
    ...patch,
  };
}

function catalogItem(itemCode: string): CatalogItem {
  return {
    id: `item-${itemCode}`,
    itemCode,
    nameRu: `Кран шаровой ${itemCode}`,
    synonyms: ["кран", "арматура"],
    equipmentType: "BALL_VALVE",
    itemKind: "COMPONENT",
    category: "VALVES",
    familyId: "family-001",
    manufacturer: "Demo Industrial",
    standard: "ГОСТ DEMO 001",
    materialGrade: "20",
    characteristics: { category: "VALVES", compatibilityStatus: "VALID_MEMBER" },
    unit: "шт.",
    cardUrl: `/catalog/${itemCode}`,
    fixtureTags: ["catalogue", "valid-member"],
    isSyntheticDemo: true,
  };
}

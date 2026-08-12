import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { getRepository, type MtrRepository } from "@/adapters/persistence/repository";
import {
  catalogBomComponents,
  catalogInterchangeabilityFamilies,
  catalogItems,
  catalogStockBalances,
} from "@/adapters/persistence/schema";
import { DEMO_USER_ID } from "@/domain/models";

const FAMILY_ID = "catalog-test-family-valve";
const SOURCE_ID = "catalog-test-item-source";
const SUBSTITUTE_ID = "catalog-test-item-substitute";
const ASSEMBLY_ID = "catalog-test-item-assembly";

describe.sequential("industrial catalog repository", () => {
  let repository: MtrRepository;

  beforeEach(async () => {
    const database = await getDatabase({ migrations: "ensure" });
    await clearCatalog();
    await resetDemoDatabase(DEMO_USER_ID, database);
    await database.insert(catalogInterchangeabilityFamilies).values({
      id: FAMILY_ID,
      userId: DEMO_USER_ID,
      code: "IG-DEMO-VALVE-DN50-PN16",
      nameRu: "Задвижки DN 50 PN 16",
      nameEn: "Gate valves DN 50 PN 16",
      equipmentType: "GATE_VALVE",
      itemKind: "COMPONENT",
      unit: "EA",
      compatibilitySignature: { nominalDiameterMm: 50, pressureClassBar: 16 },
      createdBy: DEMO_USER_ID,
    });
    await database.insert(catalogItems).values([
      item({
        id: SOURCE_ID,
        itemCode: "SAP-CAT-VALVE-0001",
        nameRu: "Задвижка клиновая DN 50 PN 16, основная",
        familyId: FAMILY_ID,
        manufacturer: "Арматом",
      }),
      item({
        id: SUBSTITUTE_ID,
        itemCode: "SAP-CAT-VALVE-0002",
        nameRu: "Задвижка клиновая DN 50 PN 16, аналог",
        familyId: FAMILY_ID,
        manufacturer: "Арматом",
      }),
      item({
        id: "catalog-test-item-decoy",
        itemCode: "SAP-CAT-VALVE-0003",
        nameRu: "Задвижка похожая DN 50 PN 10",
        familyId: null,
        manufacturer: "Другой завод",
        characteristics: { category: "VALVES", nominalDiameterMm: 50, pressureClassBar: 10 },
      }),
      item({
        id: ASSEMBLY_ID,
        itemCode: "SAP-CAT-ASM-0001",
        nameRu: "Узел запорной арматуры DN 50",
        familyId: null,
        manufacturer: "ПромУзел",
        equipmentType: "VALVE_ASSEMBLY",
        itemKind: "ASSEMBLY",
        characteristics: { category: "VALVES", nominalDiameterMm: 50 },
      }),
    ]);
    await database.insert(catalogStockBalances).values([
      balance("catalog-test-stock-source-a", SOURCE_ID, "WH-CENTRAL", 3),
      balance("catalog-test-stock-source-b", SOURCE_ID, "WH-RESERVE", 4),
      balance("catalog-test-stock-substitute-a", SUBSTITUTE_ID, "WH-CENTRAL", 5),
      balance("catalog-test-stock-substitute-b", SUBSTITUTE_ID, "WH-PROJECT", 6),
    ]);
    await database.insert(catalogBomComponents).values({
      id: "catalog-test-bom-001",
      userId: DEMO_USER_ID,
      assemblyItemId: ASSEMBLY_ID,
      componentItemId: SOURCE_ID,
      positionNumber: "0010",
      quantity: "2.000",
      unit: "EA",
      isCritical: true,
      alternativeFamilyId: FAMILY_ID,
      createdBy: DEMO_USER_ID,
    });
    repository = await getRepository();
  });

  afterAll(async () => {
    await clearCatalog();
    await closeDatabase();
  });

  it("filters before pagination and reports a stable next offset", async () => {
    const first = await repository.searchCatalogItems(DEMO_USER_ID, {
      manufacturer: "арматом",
      category: "VALVES",
      equipmentType: "GATE_VALVE",
      itemKind: "COMPONENT",
      limit: 1,
      offset: 0,
    });
    expect(first).toMatchObject({ total: 2, limit: 1, offset: 0, nextOffset: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.items[0]?.itemCode).toBe("SAP-CAT-VALVE-0001");
    expect(first.items[0]?.totalAvailableQuantity).toBe(7);

    const second = await repository.searchCatalogItems(DEMO_USER_ID, {
      name: "аналог",
      category: "VALVES",
      limit: 1,
      offset: 0,
    });
    expect(second).toMatchObject({ total: 1 });
    expect(second).not.toHaveProperty("nextOffset");
    expect(second.items[0]).toMatchObject({
      itemCode: "SAP-CAT-VALVE-0002",
      totalAvailableQuantity: 11,
      balanceCount: 2,
    });
  });

  it("returns catalogue-wide position, stock, family and BOM metrics", async () => {
    await expect(repository.getCatalogOverview(DEMO_USER_ID)).resolves.toMatchObject({
      items: 4,
      components: 3,
      assemblies: 1,
      families: 1,
      stockBalanceRows: 4,
      stockedItems: 2,
      multiWarehouseItems: 2,
      bomLinks: 1,
      totalAvailableQuantity: 18,
    });
  });

  it("returns only members of the same interchangeability family", async () => {
    const result = await repository.listCatalogFamilySubstitutes(
      DEMO_USER_ID,
      "SAP-CAT-VALVE-0001",
    );
    expect(result?.family).toMatchObject({ id: FAMILY_ID, active: true });
    expect(result?.items).toEqual([
      expect.objectContaining({
        id: SUBSTITUTE_ID,
        itemCode: "SAP-CAT-VALVE-0002",
        totalAvailableQuantity: 11,
      }),
    ]);
    expect(result?.items.map((candidate) => candidate.itemCode)).not.toContain(
      "SAP-CAT-VALVE-0003",
    );
  });

  it("aggregates exact-item balances and resolves BOM component stock and alternatives", async () => {
    const exact = await repository.getCatalogItemByCode(
      DEMO_USER_ID,
      "sap-cat-valve-0001",
    );
    expect(exact).toMatchObject({
      itemCode: "SAP-CAT-VALVE-0001",
      totalAvailableQuantity: 7,
      balanceCount: 2,
    });
    expect(exact?.balances.map((balance) => balance.availableQuantity)).toEqual([3, 4]);

    const bom = await repository.getCatalogAssemblyBom(DEMO_USER_ID, "sap-cat-asm-0001");
    expect(bom?.assembly).toMatchObject({ itemKind: "ASSEMBLY" });
    expect(bom?.components).toEqual([
      expect.objectContaining({
        positionNumber: "0010",
        quantity: 2,
        isCritical: true,
        component: expect.objectContaining({
          itemCode: "SAP-CAT-VALVE-0001",
          totalAvailableQuantity: 7,
        }),
        alternativeFamily: expect.objectContaining({ id: FAMILY_ID }),
      }),
    ]);
  });
});

function item(overrides: {
  id: string;
  itemCode: string;
  nameRu: string;
  familyId: string | null;
  manufacturer: string;
  equipmentType?: string;
  itemKind?: "COMPONENT" | "ASSEMBLY";
  characteristics?: Record<string, string | number | boolean | null>;
}): typeof catalogItems.$inferInsert {
  return {
    id: overrides.id,
    userId: DEMO_USER_ID,
    itemCode: overrides.itemCode,
    legacyCode: `LEGACY-${overrides.itemCode}`,
    manufacturerPartNumber: `MPN-${overrides.id}`,
    nameRu: overrides.nameRu,
    nameEn: overrides.nameRu,
    synonyms: ["запорная арматура", "gate valve"],
    equipmentType: overrides.equipmentType ?? "GATE_VALVE",
    itemKind: overrides.itemKind ?? "COMPONENT",
    familyId: overrides.familyId,
    manufacturer: overrides.manufacturer,
    standard: "GOST-DEMO-VALVE-CAT",
    materialGrade: "STEEL-DEMO-C20",
    characteristics: overrides.characteristics ?? {
      category: "VALVES",
      nominalDiameterMm: 50,
      pressureClassBar: 16,
    },
    unit: "EA",
    cardUrl: `/catalog/items/${overrides.itemCode}`,
    fixtureTags: ["catalog:test"],
    isSyntheticDemo: true,
    createdBy: DEMO_USER_ID,
  };
}

function balance(
  id: string,
  itemId: string,
  storageLocation: string,
  quantity: number,
): typeof catalogStockBalances.$inferInsert {
  return {
    id,
    userId: DEMO_USER_ID,
    itemId,
    plant: "PLANT-DEMO-01",
    storageLocation,
    batch: `BATCH-${id}`,
    availableQuantity: quantity.toFixed(3),
    unit: "EA",
    snapshotAt: "2026-08-12T09:00:00.000Z",
    createdBy: DEMO_USER_ID,
  };
}

async function clearCatalog(): Promise<void> {
  const database = await getDatabase({ migrations: "ensure" });
  await database.delete(catalogBomComponents);
  await database.delete(catalogStockBalances);
  await database.delete(catalogItems);
  await database.delete(catalogInterchangeabilityFamilies);
}

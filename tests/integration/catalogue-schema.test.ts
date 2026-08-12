import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import {
  catalogBomComponents,
  catalogInterchangeabilityFamilies,
  catalogItems,
  catalogStockBalances,
  users,
} from "@/adapters/persistence/schema";

describe.sequential("additive industrial catalogue schema", () => {
  beforeEach(async () => closeDatabase());
  afterAll(async () => closeDatabase());

  it("migrates four empty catalogue tables without changing the golden tables", async () => {
    const database = await getDatabase();

    const [families, items, balances, bom] = await Promise.all([
      database.select().from(catalogInterchangeabilityFamilies),
      database.select().from(catalogItems),
      database.select().from(catalogStockBalances),
      database.select().from(catalogBomComponents),
    ]);

    expect({ families, items, balances, bom }).toEqual({
      families: [],
      items: [],
      balances: [],
      bom: [],
    });
  });

  it("rejects cross-tenant catalogue relationships", async () => {
    const database = await getDatabase();
    await database.insert(users).values([
      { id: "tenant-a", userId: "tenant-a", login: "tenant-a", displayName: "Tenant A", roles: ["USER"] },
      { id: "tenant-b", userId: "tenant-b", login: "tenant-b", displayName: "Tenant B", roles: ["USER"] },
    ]);
    await database.insert(catalogInterchangeabilityFamilies).values({
      id: "family-a",
      userId: "tenant-a",
      code: "FAMILY-A",
      nameRu: "Семейство A",
      equipmentType: "PUMP",
      itemKind: "COMPONENT",
      unit: "EA",
      compatibilitySignature: { connectionDnMm: 25 },
      createdBy: "tenant-a",
    });

    await expect(
      database.insert(catalogItems).values({
        id: "item-b",
        userId: "tenant-b",
        itemCode: "ITEM-B",
        nameRu: "Материал B",
        equipmentType: "PUMP",
        itemKind: "COMPONENT",
        familyId: "family-a",
        characteristics: { connectionDnMm: 25 },
        unit: "EA",
        cardUrl: "/materials/ITEM-B",
        createdBy: "tenant-b",
      }),
    ).rejects.toThrow();
  });
});

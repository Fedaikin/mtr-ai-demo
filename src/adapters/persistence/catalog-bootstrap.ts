import { and, eq, sql } from "drizzle-orm";

import { generateIndustrialCatalogue } from "@/adapters/mock/fixtures/industrial-catalogue";
import type { IndustrialCatalogue } from "@/domain/catalogue";
import { DEMO_USER_ID } from "@/domain/models";

import { type Database, getDatabase, isRemoteDatabaseConfigured } from "./db";
import {
  catalogBomComponents,
  catalogInterchangeabilityFamilies,
  catalogItems,
  catalogStockBalances,
  users,
} from "./schema";
import {
  deleteUniversalChatDatasetRows,
  seedUniversalChatDataset,
  universalChatDatasetEnabled,
} from "./universal-chat-bootstrap";

export const EXPECTED_INDUSTRIAL_CATALOGUE_COUNTS = {
  catalogItems: 4_800,
  catalogComponents: 4_320,
  catalogAssemblies: 480,
  catalogFamilies: 960,
  catalogStockBalances: 7_200,
  catalogBomLinks: 2_880,
} as const;

export type IndustrialCatalogueCounts = {
  [Key in keyof typeof EXPECTED_INDUSTRIAL_CATALOGUE_COUNTS]: number;
};

const INSERT_BATCH_SIZE = 200;

/**
 * Replaces only the separate synthetic industrial catalogue. Golden Appius/SAP
 * fixtures and runtime runs, reports, audits, uploads and agent threads remain
 * untouched.
 */
export async function seedIndustrialCatalogue(
  userId: string = DEMO_USER_ID,
  database?: Database,
): Promise<IndustrialCatalogueCounts> {
  assertDemoUser(userId);
  const db = database ?? (await getDatabase({ migrations: "ensure" }));
  const catalogue = generateIndustrialCatalogue();
  assertGeneratedOwner(catalogue, userId);

  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.userId, userId)))
    .limit(1);
  if (!owner) {
    throw new Error(
      "Промышленный каталог не загружен: сначала создайте канонического demo-пользователя командой pnpm db:seed.",
    );
  }

  await db.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    if (isRemoteDatabaseConfigured()) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`mtr-demo-catalogue:${userId}`}))`,
      );
    }

    await deleteUniversalChatDatasetRows(tx, userId);
    await deleteIndustrialCatalogueRows(tx, userId);
    await insertBatches(tx, catalogInterchangeabilityFamilies, catalogue.families);
    await insertBatches(tx, catalogItems, catalogue.items);
    await insertBatches(
      tx,
      catalogStockBalances,
      catalogue.stockBalances.map((balance) => ({
        ...balance,
        availableQuantity: decimal(balance.availableQuantity),
      })),
    );
    await insertBatches(
      tx,
      catalogBomComponents,
      catalogue.bomLinks.map((link) => ({
        ...link,
        quantity: decimal(link.quantity),
      })),
    );
  });

  const counts = await assertIndustrialCatalogueCounts(db, userId);
  if (universalChatDatasetEnabled()) {
    await seedUniversalChatDataset(userId, db);
  }
  return counts;
}

export async function ensureIndustrialCatalogue(
  userId: string = DEMO_USER_ID,
  database?: Database,
): Promise<{ seeded: boolean; counts: IndustrialCatalogueCounts }> {
  assertDemoUser(userId);
  const db = database ?? (await getDatabase({ migrations: "ensure" }));
  const current = await getIndustrialCatalogueCounts(db, userId);
  if (matchesIndustrialCatalogueCounts(current)) {
    return { seeded: false, counts: current };
  }
  return { seeded: true, counts: await seedIndustrialCatalogue(userId, db) };
}

export async function getIndustrialCatalogueCounts(
  database: Database,
  userId: string = DEMO_USER_ID,
): Promise<IndustrialCatalogueCounts> {
  assertDemoUser(userId);
  const result = await database.execute(sql`
    select
      (select count(*)::int from ${catalogItems} where ${catalogItems.userId} = ${userId}) as "catalogItems",
      (select count(*)::int from ${catalogItems} where ${catalogItems.userId} = ${userId} and ${catalogItems.itemKind} = 'COMPONENT') as "catalogComponents",
      (select count(*)::int from ${catalogItems} where ${catalogItems.userId} = ${userId} and ${catalogItems.itemKind} = 'ASSEMBLY') as "catalogAssemblies",
      (select count(*)::int from ${catalogInterchangeabilityFamilies} where ${catalogInterchangeabilityFamilies.userId} = ${userId}) as "catalogFamilies",
      (select count(*)::int from ${catalogStockBalances} where ${catalogStockBalances.userId} = ${userId}) as "catalogStockBalances",
      (select count(*)::int from ${catalogBomComponents} where ${catalogBomComponents.userId} = ${userId}) as "catalogBomLinks"
  `);
  const rows = extractExecutedRows(result);
  const row = rows[0];
  if (!row) throw new Error("Проверка промышленного каталога не вернула счётчики.");
  return Object.fromEntries(
    Object.keys(EXPECTED_INDUSTRIAL_CATALOGUE_COUNTS).map((key) => [
      key,
      Number(row[key] ?? 0),
    ]),
  ) as IndustrialCatalogueCounts;
}

export async function assertIndustrialCatalogueCounts(
  database: Database,
  userId: string = DEMO_USER_ID,
): Promise<IndustrialCatalogueCounts> {
  const counts = await getIndustrialCatalogueCounts(database, userId);
  const mismatches = Object.entries(EXPECTED_INDUSTRIAL_CATALOGUE_COUNTS).flatMap(
    ([key, expected]) => {
      const actual = counts[key as keyof IndustrialCatalogueCounts];
      return actual === expected ? [] : [`${key}: ожидалось ${expected}, получено ${actual}`];
    },
  );
  if (mismatches.length > 0) {
    throw new Error(`Проверка промышленного каталога не пройдена (${mismatches.join("; ")}).`);
  }
  return counts;
}

export async function deleteIndustrialCatalogueRows(
  database: Database,
  userId: string = DEMO_USER_ID,
): Promise<void> {
  assertDemoUser(userId);
  await database.delete(catalogBomComponents).where(eq(catalogBomComponents.userId, userId));
  await database.delete(catalogStockBalances).where(eq(catalogStockBalances.userId, userId));
  await database.delete(catalogItems).where(eq(catalogItems.userId, userId));
  await database
    .delete(catalogInterchangeabilityFamilies)
    .where(eq(catalogInterchangeabilityFamilies.userId, userId));
}

async function insertBatches<
  TTable extends Parameters<Database["insert"]>[0],
  TRow extends object,
>(
  database: Database,
  table: TTable,
  rows: readonly TRow[],
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + INSERT_BATCH_SIZE);
    if (batch.length > 0) {
      await database.insert(table).values(batch as never);
    }
  }
}

function matchesIndustrialCatalogueCounts(counts: IndustrialCatalogueCounts): boolean {
  return Object.entries(EXPECTED_INDUSTRIAL_CATALOGUE_COUNTS).every(
    ([key, expected]) => counts[key as keyof IndustrialCatalogueCounts] === expected,
  );
}

function assertGeneratedOwner(catalogue: IndustrialCatalogue, userId: string): void {
  const ownerIds = [
    catalogue.manifest.ownerUserId,
    ...catalogue.families.map((row) => row.userId),
    ...catalogue.items.map((row) => row.userId),
    ...catalogue.stockBalances.map((row) => row.userId),
    ...catalogue.bomLinks.map((row) => row.userId),
  ];
  if (ownerIds.some((ownerId) => ownerId !== userId)) {
    throw new Error("Промышленный каталог содержит строку вне доверенного demo-контура.");
  }
}

function extractExecutedRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as Array<Record<string, unknown>>;
  }
  return [];
}

function decimal(value: number): string {
  return value.toFixed(3);
}

function assertDemoUser(userId: string): asserts userId is typeof DEMO_USER_ID {
  if (userId !== DEMO_USER_ID) {
    throw new Error("Промышленный demo-каталог разрешён только для demo-user-001.");
  }
}

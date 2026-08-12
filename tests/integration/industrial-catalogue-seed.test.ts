import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  INDUSTRIAL_CATALOGUE_REPRESENTATIVE,
} from "@/adapters/mock/fixtures/industrial-catalogue";
import {
  EXPECTED_BASE_COUNTS,
  getSeedCounts,
  resetDemoDatabase,
} from "@/adapters/persistence/bootstrap";
import {
  EXPECTED_INDUSTRIAL_CATALOGUE_COUNTS,
  ensureIndustrialCatalogue,
  seedIndustrialCatalogue,
} from "@/adapters/persistence/catalog-bootstrap";
import { closeDatabase, getDatabase, type Database } from "@/adapters/persistence/db";
import { MtrRepository } from "@/adapters/persistence/repository";
import { agentThreads, auditLogs } from "@/adapters/persistence/schema";
import { DEMO_USER_ID } from "@/domain/models";

const RUNTIME_THREAD_ID = "agent-thread-catalogue-seed-proof";
const RUNTIME_AUDIT_ID = "audit-catalogue-seed-proof";

describe.sequential("additive industrial catalogue seed", () => {
  beforeEach(async () => {
    await closeDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("seeds and re-seeds the large catalogue without changing golden or runtime rows", async () => {
    const database = await getDatabase({ migrations: "ensure" });
    await resetDemoDatabase(DEMO_USER_ID, database);
    await insertRuntimeProofRows(database);

    const goldenBefore = await getSeedCounts(database, DEMO_USER_ID);
    const runtimeBefore = await selectRuntimeProofRows(database);
    expect(goldenBefore).toEqual(EXPECTED_BASE_COUNTS);

    const firstCounts = await seedIndustrialCatalogue(DEMO_USER_ID, database);
    expect(firstCounts).toEqual(EXPECTED_INDUSTRIAL_CATALOGUE_COUNTS);
    expect(firstCounts).toMatchObject({
      catalogItems: 4_800,
      catalogComponents: 4_320,
      catalogAssemblies: 480,
      catalogFamilies: 960,
      catalogStockBalances: 7_200,
      catalogBomLinks: 2_880,
    });

    const repository = new MtrRepository(database);
    const firstRepresentativeResult = await representativeQueries(repository);
    expect(firstRepresentativeResult).toEqual({
      substituteCodes: [...INDUSTRIAL_CATALOGUE_REPRESENTATIVE.compatibleItemCodes],
      decoyHasNoFamily: true,
      bomComponentCount: 6,
      bomComponentsHaveFamilies: true,
    });

    const ensured = await ensureIndustrialCatalogue(DEMO_USER_ID, database);
    expect(ensured).toEqual({
      seeded: false,
      counts: EXPECTED_INDUSTRIAL_CATALOGUE_COUNTS,
    });

    const secondCounts = await seedIndustrialCatalogue(DEMO_USER_ID, database);
    const secondRepresentativeResult = await representativeQueries(repository);
    expect(secondCounts).toEqual(firstCounts);
    expect(secondRepresentativeResult).toEqual(firstRepresentativeResult);

    expect(await getSeedCounts(database, DEMO_USER_ID)).toEqual(goldenBefore);
    expect(await selectRuntimeProofRows(database)).toEqual(runtimeBefore);
  }, 60_000);
});

async function representativeQueries(repository: MtrRepository): Promise<{
  substituteCodes: string[];
  decoyHasNoFamily: boolean;
  bomComponentCount: number;
  bomComponentsHaveFamilies: boolean;
}> {
  const [substitutes, decoy, bom] = await Promise.all([
    repository.listCatalogFamilySubstitutes(
      DEMO_USER_ID,
      INDUSTRIAL_CATALOGUE_REPRESENTATIVE.itemCode,
    ),
    repository.getCatalogItemByCode(
      DEMO_USER_ID,
      INDUSTRIAL_CATALOGUE_REPRESENTATIVE.incompatibleDecoyCode,
    ),
    repository.getCatalogAssemblyBom(
      DEMO_USER_ID,
      INDUSTRIAL_CATALOGUE_REPRESENTATIVE.assemblyCode,
    ),
  ]);

  expect(substitutes?.family?.code).toBe(
    INDUSTRIAL_CATALOGUE_REPRESENTATIVE.familyCode,
  );
  expect(substitutes?.items.map((item) => item.itemCode)).not.toContain(
    INDUSTRIAL_CATALOGUE_REPRESENTATIVE.incompatibleDecoyCode,
  );
  expect(bom?.assembly.itemCode).toBe(INDUSTRIAL_CATALOGUE_REPRESENTATIVE.assemblyCode);

  return {
    substituteCodes: substitutes?.items.map((item) => item.itemCode) ?? [],
    decoyHasNoFamily:
      decoy?.characteristics.compatibilityStatus === "INCOMPATIBLE_DECOY" &&
      !("familyId" in decoy),
    bomComponentCount: bom?.components.length ?? 0,
    bomComponentsHaveFamilies:
      bom?.components.every(
        (component) =>
          component.component.itemKind === "COMPONENT" &&
          component.component.familyId === component.alternativeFamily?.id,
      ) ?? false,
  };
}

async function insertRuntimeProofRows(database: Database): Promise<void> {
  await database.insert(agentThreads).values({
    id: RUNTIME_THREAD_ID,
    userId: DEMO_USER_ID,
    title: "Проверка сохранности runtime при загрузке каталога",
    createdBy: DEMO_USER_ID,
  });
  await database.insert(auditLogs).values({
    id: RUNTIME_AUDIT_ID,
    userId: DEMO_USER_ID,
    actorDisplayName: "Демо-пользователь 1",
    action: "CATALOGUE_SEED_PROOF",
    entityType: "CATALOGUE",
    entityId: INDUSTRIAL_CATALOGUE_REPRESENTATIVE.itemCode,
    outcome: "SUCCESS",
    details: { purpose: "integration-test" },
    occurredAt: "2026-08-12T09:00:00.000Z",
    retentionUntil: "2027-08-12T09:00:00.000Z",
    requestId: "request-catalogue-seed-proof",
  });
}

async function selectRuntimeProofRows(database: Database): Promise<{
  threads: Array<typeof agentThreads.$inferSelect>;
  audits: Array<typeof auditLogs.$inferSelect>;
}> {
  const [threads, audits] = await Promise.all([
    database
      .select()
      .from(agentThreads)
      .where(eq(agentThreads.id, RUNTIME_THREAD_ID)),
    database.select().from(auditLogs).where(eq(auditLogs.id, RUNTIME_AUDIT_ID)),
  ]);
  return { threads, audits };
}

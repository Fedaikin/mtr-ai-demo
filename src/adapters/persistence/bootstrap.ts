import { and, eq, sql } from "drizzle-orm";

import appiusFixture from "@/adapters/mock/fixtures/appius.json";
import {
  generateSpecificationPortfolio,
  SPECIFICATION_PORTFOLIO_MANIFEST,
  type SpecificationPortfolioFixture,
} from "@/adapters/mock/fixtures/specification-portfolio";
import identityFixture from "@/adapters/mock/fixtures/identity.json";
import normativeFixture from "@/adapters/mock/fixtures/normative.json";
import sapFixture from "@/adapters/mock/fixtures/sap.json";
import scenariosFixture from "@/adapters/mock/fixtures/scenarios.json";
import {
  MTR_AGENT_ORCHESTRATOR_PROMPT,
  MTR_AGENT_ORCHESTRATOR_VERSION,
  MTR_AGENT_PROMPT_NAME,
  MTR_AGENT_ROLLBACK_PROMPT,
  MTR_AGENT_ROLLBACK_VERSION,
  MTR_AGENT_UNIVERSAL_BASE_PROMPT,
  MTR_AGENT_UNIVERSAL_BASE_VERSION,
  MTR_AGENT_UNIVERSAL_PROMPT,
  MTR_AGENT_UNIVERSAL_VERSION,
  promptChecksum,
} from "@/application/agent-orchestrator/system-prompt";
import { DEMO_USER_ID } from "@/domain/models";

import {
  EXPECTED_INDUSTRIAL_CATALOGUE_COUNTS,
  ensureIndustrialCatalogue,
  getIndustrialCatalogueCounts,
  type IndustrialCatalogueCounts,
} from "./catalog-bootstrap";
import { type Database, getDatabase, isRemoteDatabaseConfigured } from "./db";
import { createReadinessCache } from "./readiness-cache";
import {
  agentCitations,
  agentActionProposals,
  agentCases,
  agentEventInbox,
  agentEvidenceFacts,
  agentLearningCandidates,
  agentMetricEvents,
  agentMessages,
  agentPlanExecutions,
  agentProactiveInsights,
  agentTasks,
  agentThreads,
  analogueRules,
  analysisReviewDecisions,
  auditLogs,
  authSessions,
  dictionaries,
  integrationStates,
  materialMovements,
  normativeChunks,
  normativeDocuments,
  positionAnalysisResults,
  promptVersions,
  responsibilityRules,
  sapMaterials,
  sapStockBalances,
  scenarioRuns,
  scenarioRunSteps,
  scenarios,
  specificationPositions,
  specificationVersions,
  specifications,
  uploadedFiles,
  users,
} from "./schema";
import {
  EXPECTED_UNIVERSAL_CHAT_COUNTS,
  deleteUniversalChatDatasetRows,
  ensureUniversalChatDataset,
  getUniversalChatCounts,
  type UniversalChatCounts,
  universalChatDatasetEnabled,
} from "./universal-chat-bootstrap";

export const EXPECTED_BASE_COUNTS = {
  users: 8,
  specifications: 83,
  specificationVersions: 88,
  canonicalPositions: 3_584,
  sapMaterials: 30,
  sapBalances: 30,
  normativeDocuments: 4,
  normativeChunks: 16,
  responsibilityRules: 5,
  analogueRules: 3,
  integrations: 4,
  scenarios: 5,
  prompts: 4,
  dictionaries: 7,
} as const;

export type SeedCounts = { [Key in keyof typeof EXPECTED_BASE_COUNTS]: number };

interface DatabaseInitializationResult {
  seeded: boolean;
  counts: SeedCounts;
}

export interface UniversalAgentRolloutResult {
  baseCounts: SeedCounts;
  catalogueCounts: IndustrialCatalogueCounts;
  universalCounts: UniversalChatCounts;
  portfolioAdded: boolean;
  promptVersionsAdded: number;
  catalogueAdded: boolean;
  universalDatasetAdded: boolean;
  warehouseClaimsAdded: number;
}

// Deduplicates concurrent/repeated login bootstrap attempts while remaining
// bounded. Authenticated runtime reads never enter this destructive readiness
// boundary; health/count endpoints still query exact data, and reset/seed
// invalidate this entry immediately.
const READINESS_CACHE_TTL_MS = 5 * 60_000;
const FIXTURE_INSERT_BATCH_SIZE = 200;
const EXACT_BASELINE_COUNT_KEYS = [
  "specifications",
  "canonicalPositions",
  "sapMaterials",
  "sapBalances",
  "normativeDocuments",
  "normativeChunks",
  "responsibilityRules",
  "analogueRules",
  "integrations",
  "scenarios",
  "dictionaries",
] as const satisfies ReadonlyArray<keyof SeedCounts>;
// Administrators may add human demo accounts without changing the canonical
// operational dataset. The seed gate therefore requires the base accounts to
// exist, but does not treat an additional account as a corrupted seed.
const MINIMUM_BASELINE_COUNT_KEYS = [
  "users",
  "specificationVersions",
  "prompts",
] as const satisfies ReadonlyArray<keyof SeedCounts>;
const bootstrapGlobal = globalThis as typeof globalThis & {
  __mtrDatabaseReadinessCache?: ReturnType<
    typeof createReadinessCache<DatabaseInitializationResult>
  >;
};
const databaseReadinessCache = (bootstrapGlobal.__mtrDatabaseReadinessCache ??=
  createReadinessCache<DatabaseInitializationResult>({ ttlMs: READINESS_CACHE_TTL_MS }));

export const INITIAL_AGENT_PROMPT = MTR_AGENT_ROLLBACK_PROMPT;

/** Login/CLI bootstrap boundary: migrates and repairs a missing canonical seed. */
export async function initializeDatabase(): Promise<DatabaseInitializationResult> {
  validateFixtures();
  const db = await getDatabase({ migrations: "ensure" });
  const result = await databaseReadinessCache.resolve(db, async () => {
    const current = await getSeedCounts(db, DEMO_USER_ID);
    if (matchesExpectedCounts(current)) return { seeded: false, counts: current };
    if (matchesAdditiveBaseUpgradeCandidate(current)) {
      const upgraded = await upgradeLegacyBaseDataset(db, DEMO_USER_ID, current);
      if (matchesExpectedCounts(upgraded)) return { seeded: true, counts: upgraded };
    }

    const counts = await seedDatabaseUncached(DEMO_USER_ID, db);
    return { seeded: true, counts };
  });
  let extendedSeeded = false;
  if (universalChatDatasetEnabled()) {
    const catalogue = await ensureIndustrialCatalogue(DEMO_USER_ID, db);
    const universal = await ensureUniversalChatDataset(DEMO_USER_ID, db);
    extendedSeeded = catalogue.seeded || universal.seeded;
  }
  return { seeded: result.seeded || extendedSeeded, counts: { ...result.counts } };
}

/**
 * Additively upgrades a live demo database for the universal MTR agent.
 *
 * This boundary deliberately refuses partially-corrupted data instead of
 * falling back to the destructive canonical seed. Runtime chats, runs,
 * reports, audit records, users and RBAC rows are never deleted here.
 */
export async function rolloutUniversalAgentDataset(
  database?: Database,
): Promise<UniversalAgentRolloutResult> {
  validateFixtures();
  const db = database ?? (await getDatabase({ migrations: "ensure" }));
  const before = await getSeedCounts(db, DEMO_USER_ID);
  if (!matchesExpectedCounts(before) && !matchesAdditiveBaseUpgradeCandidate(before)) {
    throw new Error(
      `Аддитивное обновление остановлено: базовые счётчики не соответствуют доверенному legacy/target-профилю (${formatSeedCounts(before)}).`,
    );
  }

  const baseCounts = await upgradeLegacyBaseDataset(db, DEMO_USER_ID, before, true);
  if (!matchesExpectedCounts(baseCounts)) {
    throw new Error(
      `Аддитивное обновление не достигло целевого базового профиля (${formatSeedCounts(baseCounts)}).`,
    );
  }

  const warehouseClaimsAdded = await ensureDemoWarehouseAccessClaims(db);

  const catalogueBefore = await getIndustrialCatalogueCounts(db, DEMO_USER_ID);
  assertEmptyOrExpectedCounts(
    "промышленного каталога",
    catalogueBefore,
    EXPECTED_INDUSTRIAL_CATALOGUE_COUNTS,
  );
  const catalogue = await ensureIndustrialCatalogue(DEMO_USER_ID, db);

  const universalBefore = await getUniversalChatCounts(db);
  assertEmptyOrExpectedCounts(
    "универсального набора МТР-агента",
    universalBefore,
    EXPECTED_UNIVERSAL_CHAT_COUNTS,
  );
  const universal = await ensureUniversalChatDataset(DEMO_USER_ID, db);

  return {
    baseCounts,
    catalogueCounts: catalogue.counts,
    universalCounts: universal.counts,
    portfolioAdded:
      before.specifications !== baseCounts.specifications ||
      before.canonicalPositions !== baseCounts.canonicalPositions,
    promptVersionsAdded: Math.max(0, baseCounts.prompts - before.prompts),
    catalogueAdded: catalogue.seeded,
    universalDatasetAdded: universal.seeded,
    warehouseClaimsAdded,
  };
}

/**
 * Replaces only the trusted demo user's rows, in one transaction, with the
 * checked-in fixtures. IDs and fixture-derived values are deterministic.
 */
export async function seedDatabase(
  userId: string = DEMO_USER_ID,
  database?: Database,
): Promise<SeedCounts> {
  assertDemoUser(userId);
  validateFixtures();
  const db = database ?? (await getDatabase());
  databaseReadinessCache.invalidate(db);
  try {
    return await seedDatabaseUncached(userId, db);
  } finally {
    // A readiness check racing with the mutation must not survive it, even if
    // the transaction fails and leaves the previous canonical seed intact.
    databaseReadinessCache.invalidate(db);
  }
}

async function seedDatabaseUncached(userId: string, db: Database): Promise<SeedCounts> {
  const existingUsers = await db.select({ id: users.id }).from(users);
  if (existingUsers.some((row) => row.id !== userId && !row.id.startsWith("demo-"))) {
    throw new Error(
      "Seed остановлен: база содержит пользователя вне демонстрационного контура; чужие данные не изменены.",
    );
  }

  await db.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    // Parallel reset requests can be issued by browsers or deployment checks.
    // PostgreSQL serializes them for this demo owner; PGlite already executes
    // transactions on its single local connection.
    if (isRemoteDatabaseConfigured()) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`mtr-demo-reset:${userId}`}))`);
    }
    // Keep the identity parent row stable. Deleting it creates an avoidable FK
    // race with an in-flight audit write during a cloud reset.
    await deleteUserScopedRows(tx, userId, false);
    await insertFixtureRows(tx, userId);
  });

  if (universalChatDatasetEnabled()) {
    await ensureIndustrialCatalogue(userId, db);
    await ensureUniversalChatDataset(userId, db);
  }

  return assertSeedCounts(userId, db);
}

/** Application-safe reset: only demo-scoped rows are replaced, atomically. */
export async function resetDemoDatabase(
  userId: string = DEMO_USER_ID,
  database?: Database,
): Promise<SeedCounts> {
  return seedDatabase(userId, database);
}

export const resetDemoData = resetDemoDatabase;

export async function assertSeedCounts(
  userId: string = DEMO_USER_ID,
  database?: Database,
): Promise<SeedCounts> {
  assertDemoUser(userId);
  const db = database ?? (await getDatabase());
  const counts = await getSeedCounts(db, userId);
  const mismatches = Object.entries(EXPECTED_BASE_COUNTS).flatMap(([key, expected]) => {
    const actual = counts[key as keyof SeedCounts];
    const isMinimum = (MINIMUM_BASELINE_COUNT_KEYS as readonly string[]).includes(key);
    return (isMinimum ? actual >= expected : actual === expected)
      ? []
      : [`${key}: ожидалось ${isMinimum ? "не менее " : ""}${expected}, получено ${actual}`];
  });
  if (mismatches.length > 0) {
    throw new Error(`Проверка канонического seed не пройдена (${mismatches.join("; ")}).`);
  }
  return counts;
}

export async function getSeedCounts(
  database: Database,
  userId: string = DEMO_USER_ID,
): Promise<SeedCounts> {
  // Login bootstrap and explicit health/count diagnostics use this exact query.
  // Scalar subqueries preserve the invariants in one PostgreSQL round-trip.
  const result = await database.execute(sql`
    select
      (select count(*)::int from ${users}) as "users",
      (select count(*)::int from ${specifications} where ${specifications.userId} = ${userId}) as "specifications",
      (select count(*)::int from ${specificationVersions} where ${specificationVersions.userId} = ${userId}) as "specificationVersions",
      (select count(*)::int
        from ${specificationPositions}
        inner join ${specificationVersions}
          on ${specificationVersions.id} = ${specificationPositions.versionId}
          and ${specificationVersions.userId} = ${userId}
        where ${specificationPositions.userId} = ${userId}
          and ${specificationVersions.isCurrent} = true) as "canonicalPositions",
      (select count(*)::int from ${sapMaterials} where ${sapMaterials.userId} = ${userId}) as "sapMaterials",
      (select count(*)::int from ${sapStockBalances} where ${sapStockBalances.userId} = ${userId}) as "sapBalances",
      (select count(*)::int from ${normativeDocuments} where ${normativeDocuments.userId} = ${userId}) as "normativeDocuments",
      (select count(*)::int from ${normativeChunks} where ${normativeChunks.userId} = ${userId}) as "normativeChunks",
      (select count(*)::int from ${responsibilityRules} where ${responsibilityRules.userId} = ${userId}) as "responsibilityRules",
      (select count(*)::int from ${analogueRules} where ${analogueRules.userId} = ${userId}) as "analogueRules",
      (select count(*)::int from ${integrationStates} where ${integrationStates.userId} = ${userId}) as "integrations",
      (select count(*)::int from ${scenarios} where ${scenarios.userId} = ${userId}) as "scenarios",
      (select count(*)::int from ${promptVersions} where ${promptVersions.userId} = ${userId}) as "prompts",
      (select count(*)::int from ${dictionaries} where ${dictionaries.userId} = ${userId}) as "dictionaries"
  `);
  const rows = extractExecutedRows(result);
  const row = rows[0];
  if (!row) throw new Error("Проверка канонического seed не вернула счётчики.");

  return Object.fromEntries(
    Object.keys(EXPECTED_BASE_COUNTS).map((key) => [key, Number(row[key] ?? 0)]),
  ) as SeedCounts;
}

function extractExecutedRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as Array<Record<string, unknown>>;
  }
  return [];
}

async function insertBatches<
  TTable extends Parameters<Database["insert"]>[0],
  TRow extends object,
>(database: Database, table: TTable, rows: readonly TRow[]): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += FIXTURE_INSERT_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + FIXTURE_INSERT_BATCH_SIZE);
    if (batch.length > 0) await database.insert(table).values(batch as never);
  }
}

async function addSpecificationPortfolio(db: Database, userId: string): Promise<void> {
  const rows = buildSpecificationPortfolioRows(generateSpecificationPortfolio(), userId);
  await db.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    if (isRemoteDatabaseConfigured()) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`mtr-demo-specification-portfolio:${userId}`}))`,
      );
    }
    await tx.insert(specifications).values(rows.specifications);
    await tx.insert(specificationVersions).values(rows.versions);
    await insertBatches(tx, specificationPositions, rows.positions);
  });
}

async function upgradeLegacyBaseDataset(
  db: Database,
  userId: string,
  current: SeedCounts,
  refreshCanonicalPrompts = false,
): Promise<SeedCounts> {
  if (matchesLegacySpecificationPortfolioCounts(current)) {
    await addSpecificationPortfolio(db, userId);
  }
  if (current.prompts < EXPECTED_BASE_COUNTS.prompts || refreshCanonicalPrompts) {
    await upsertCanonicalPromptVersions(db, userId);
  }
  databaseReadinessCache.invalidate(db);
  return getSeedCounts(db, userId);
}

async function upsertCanonicalPromptVersions(db: Database, userId: string): Promise<void> {
  await db.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    if (isRemoteDatabaseConfigured()) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`mtr-demo-prompts:${userId}`}))`,
      );
    }
    await tx
      .update(promptVersions)
      .set({ active: false, version: sql`${promptVersions.version} + 1` })
      .where(and(eq(promptVersions.userId, userId), eq(promptVersions.name, MTR_AGENT_PROMPT_NAME)));
    for (const row of canonicalPromptVersionRows(userId)) {
      await tx
        .insert(promptVersions)
        .values(row)
        .onConflictDoUpdate({
          target: [promptVersions.userId, promptVersions.name, promptVersions.promptVersion],
          set: {
            content: row.content,
            active: row.active,
            checksum: row.checksum,
            updatedAt: new Date().toISOString(),
            version: sql`${promptVersions.version} + 1`,
          },
        });
    }
  });
}

function buildSpecificationPortfolioRows(
  fixture: SpecificationPortfolioFixture,
  userId: string,
) {
  return {
    specifications: fixture.specifications.map((item) => ({
      id: item.id,
      userId,
      projectCode: item.projectCode,
      name: item.name,
      latestVersionId: item.latestVersionId,
      latestVersionNumber: item.latestVersionNumber,
      positionCount: item.positionCount,
      accessAttributes: accessAttributes(item.access),
      createdBy: userId,
    })),
    versions: fixture.specificationVersions.map((item) => ({
      id: item.id,
      specificationId: item.specificationId,
      userId,
      versionNumber: item.versionNumber,
      isCurrent: item.isCurrent,
      status: item.status,
      effectiveAt: item.effectiveAt,
      positionCount: item.positionCount,
      accessAttributes: accessAttributes(item.access),
      createdBy: userId,
    })),
    positions: fixture.positions.map((item) => ({
      id: item.id,
      specificationId: item.specificationId,
      versionId: item.versionId,
      userId,
      internalCode: item.internalCode,
      nameRu: item.nameRu,
      nameEn: item.nameEn,
      synonyms: [...item.synonyms],
      equipmentType: item.equipmentType,
      standard: item.standard,
      materialGrade: item.materialGrade,
      dimensions: scalarRecord(item.dimensions),
      requiredQuantity: decimal(item.requiredQuantity),
      unit: item.unit,
      classification: { ...item.classification },
      accessAttributes: accessAttributes(item.access),
      fixtureTags: [...item.fixtureTags],
      isSyntheticDemo: true,
      createdBy: userId,
    })),
  };
}

async function insertFixtureRows(db: Database, userId: string): Promise<void> {
  const portfolioFixture = generateSpecificationPortfolio();
  const portfolioRows = buildSpecificationPortfolioRows(portfolioFixture, userId);
  const fixtureUser = identityFixture.users[0];
  const fixtureHash = requiredDemoPasswordHash();
  const userValues = {
    id: userId,
    userId,
    login: "demo",
    passwordHash: fixtureHash,
    displayName: fixtureUser.displayName,
    roles: [...fixtureUser.roles],
    locale: fixtureUser.locale,
    isSyntheticDemo: true,
    createdBy: userId,
  };
  await db
    .insert(users)
    .values(userValues)
    .onConflictDoUpdate({
      target: users.id,
      set: {
        userId: userValues.userId,
        login: userValues.login,
        displayName: userValues.displayName,
        roles: userValues.roles,
        locale: userValues.locale,
        isSyntheticDemo: userValues.isSyntheticDemo,
        createdBy: userValues.createdBy,
        updatedAt: new Date().toISOString(),
      },
    });

  await seedRbacSubjects(db, fixtureHash);

  await db.insert(specifications).values(
    [
      ...appiusFixture.specifications.map((item) => ({
        id: item.id,
        userId,
        projectCode: item.projectCode,
        name: item.name,
        latestVersionId: item.latestVersionId,
        latestVersionNumber: item.latestVersionNumber,
        positionCount: item.positionCount,
        accessAttributes: accessAttributes(item.access),
        createdBy: userId,
      })),
      ...portfolioRows.specifications,
    ],
  );

  const historicByVersion = new Map(
    appiusFixture.historicSnapshots.map((snapshot) => [snapshot.versionId, asJsonRecord(snapshot)]),
  );
  await db.insert(specificationVersions).values([
    ...appiusFixture.specificationVersions.map((item) => ({
      id: item.id,
      specificationId: item.specificationId,
      userId,
      versionNumber: item.versionNumber,
      isCurrent: item.isCurrent,
      status: item.status,
      effectiveAt: item.effectiveAt,
      positionCount: item.positionCount,
      historicSnapshot: historicByVersion.get(item.id),
      accessAttributes: accessAttributes(item.access),
      createdBy: userId,
    })),
    ...portfolioRows.versions,
  ]);

  await insertBatches(
    db,
    specificationPositions,
    [
      ...appiusFixture.positions.map((item) => ({
        id: item.id,
        specificationId: item.specificationId,
        versionId: item.versionId,
        userId,
        internalCode: item.internalCode,
        nameRu: item.nameRu,
        nameEn: item.nameEn,
        synonyms: [...item.synonyms],
        equipmentType: item.equipmentType,
        standard: item.standard,
        materialGrade: item.materialGrade,
        dimensions: scalarRecord(item.dimensions),
        requiredQuantity: decimal(item.requiredQuantity),
        unit: item.unit,
        classification: { ...item.classification },
        accessAttributes: accessAttributes(item.access),
        fixtureTags: [...item.fixtureTags],
        isSyntheticDemo: true,
        createdBy: userId,
      })),
      ...portfolioRows.positions,
    ],
  );

  const materialRows = sapFixture.materials.map((item) => ({
    id: item.recordId,
    userId,
    materialCode: item.materialCode,
    nameRu: item.nameRu,
    nameEn: item.nameEn,
    synonyms: [...item.synonyms],
    legacyCode: item.legacyCode,
    equipmentType: item.equipmentType,
    standard: item.standard,
    materialGrade: item.materialGrade,
    dimensions: scalarRecord(item.dimensions),
    tolerances: scalarRecord(item.tolerances),
    unit: item.unit,
    cardUrl: item.materialCardUrl,
    sourcePositionId: item.expectedMatch?.targetPositionId,
    fixtureTags: [...item.fixtureTags],
    isSyntheticDemo: true,
    createdBy: userId,
  }));
  await db.insert(sapMaterials).values(materialRows);
  await db.insert(sapStockBalances).values(
    sapFixture.materials.map((item) => ({
      id: `balance-${item.recordId}`,
      userId,
      materialId: item.recordId,
      plant: item.plant,
      storageLocation: item.warehouse,
      batch: item.batch,
      availableQuantity: decimal(item.availableQuantity),
      unit: item.unit,
      snapshotAt: item.snapshotDate,
      createdBy: userId,
    })),
  );
  await db.insert(materialMovements).values(buildMaterialMovementRows());
  await db.insert(agentMetricEvents).values(buildProcessMetricEventRows());

  const documentRows = normativeFixture.documents.map((item, index) => ({
    id: `normative-document-${String(index + 1).padStart(3, "0")}`,
    userId,
    documentId: item.documentId,
    title: item.title,
    documentVersion: item.version,
    effectiveAt: isoDate(item.effectiveFrom),
    accessAttributes: accessAttributes(item.access),
    isSyntheticDemo: true,
    createdBy: userId,
  }));
  const documentIdByNaturalKey = new Map(
    documentRows.map((item) => [naturalDocumentKey(item.documentId, item.documentVersion), item.id]),
  );
  await db.insert(normativeDocuments).values(documentRows);

  await db.insert(normativeChunks).values(
    normativeFixture.chunks.map((item) => ({
      id: item.chunkId,
      userId,
      normativeDocumentId: requireDocumentId(documentIdByNaturalKey, item.documentId, item.version),
      clauseId: item.clauseId,
      title: item.title,
      text: item.text,
      language: item.language,
      equipmentTypes: [...item.equipmentTypes],
      applicability: { ...item.applicability },
      allowedDeviations: { ...item.allowedDeviations },
      accessAttributes: accessAttributes(item.access),
      isSyntheticDemo: true,
      createdBy: userId,
    })),
  );

  const russianChunkText = new Map(
    normativeFixture.chunks
      .filter((chunk) => chunk.language === "ru")
      .map((chunk) => [naturalClauseKey(chunk.documentId, chunk.version, chunk.clauseId), chunk.text]),
  );

  await db.insert(responsibilityRules).values(
    normativeFixture.responsibilityRules.map((item) => ({
      id: item.ruleId,
      userId,
      normativeDocumentId: requireDocumentId(documentIdByNaturalKey, item.documentId, item.version),
      clauseId: item.clauseId,
      equipmentTypes: [...item.equipmentTypes],
      responsibility: item.responsibility,
      conditions: {
        confidence: item.confidence,
        ...(item.requiresHumanReviewWhen
          ? { requiresHumanReviewWhen: item.requiresHumanReviewWhen, expertReviewForCritical: true }
          : {}),
      },
      ruleText:
        russianChunkText.get(naturalClauseKey(item.documentId, item.version, item.clauseId)) ??
        `Синтетическое правило ${item.ruleId}`,
      active: true,
      createdBy: userId,
    })),
  );

  await db.insert(analogueRules).values(
    normativeFixture.analogueRules.map((item) => {
      const pairs = deriveAnaloguePairs(item.equipmentType);
      return {
        id: item.ruleId,
        userId,
        normativeDocumentId: requireDocumentId(documentIdByNaturalKey, item.documentId, item.version),
        clauseId: item.clauseId,
        equipmentTypes: [item.equipmentType],
        allowedStandardPairs: pairs.standards,
        allowedMaterialPairs: pairs.materials,
        dimensionTolerances: deriveDimensionTolerances(item.equipmentType, asJsonRecord(item.criteria)),
        ruleText:
          russianChunkText.get(naturalClauseKey(item.documentId, item.version, item.clauseId)) ??
          `Синтетическое правило ${item.ruleId}`,
        active: true,
        createdBy: userId,
      };
    }),
  );

  await db.insert(integrationStates).values(buildIntegrationRows(userId));

  await db.insert(scenarios).values(
    scenariosFixture.scenarios.map((item) => ({
      id: item.id,
      userId,
      name: item.name,
      description: item.description,
      kind: scenarioKind(item.id),
      enabled: item.enabled,
      configuration: asJsonRecord(item),
      createdBy: userId,
    })),
  );

  await db.insert(promptVersions).values(canonicalPromptVersionRows(userId));

  await db.insert(dictionaries).values(
    normativeFixture.searchDictionary.map((item, index) => ({
      id: `dictionary-${String(index + 1).padStart(3, "0")}`,
      userId,
      dictionaryType: "MTR_SEARCH_SYNONYMS",
      key: item.canonical,
      values: [...item.terms],
      active: true,
      createdBy: userId,
    })),
  );
}

function canonicalPromptVersionRows(userId: string) {
  return [
    {
      id: "prompt-mtr-agent-001",
      userId,
      name: MTR_AGENT_PROMPT_NAME,
      promptVersion: MTR_AGENT_ROLLBACK_VERSION,
      content: MTR_AGENT_ROLLBACK_PROMPT,
      active: false,
      checksum: promptChecksum(MTR_AGENT_ROLLBACK_PROMPT),
      createdBy: userId,
    },
    {
      id: "prompt-mtr-agent-003",
      userId,
      name: MTR_AGENT_PROMPT_NAME,
      promptVersion: MTR_AGENT_ORCHESTRATOR_VERSION,
      content: MTR_AGENT_ORCHESTRATOR_PROMPT,
      active: false,
      checksum: promptChecksum(MTR_AGENT_ORCHESTRATOR_PROMPT),
      createdBy: userId,
    },
    {
      id: "prompt-mtr-agent-004",
      userId,
      name: MTR_AGENT_PROMPT_NAME,
      promptVersion: MTR_AGENT_UNIVERSAL_BASE_VERSION,
      content: MTR_AGENT_UNIVERSAL_BASE_PROMPT,
      active: false,
      checksum: promptChecksum(MTR_AGENT_UNIVERSAL_BASE_PROMPT),
      createdBy: userId,
    },
    {
      id: "prompt-mtr-agent-005",
      userId,
      name: MTR_AGENT_PROMPT_NAME,
      promptVersion: MTR_AGENT_UNIVERSAL_VERSION,
      content: MTR_AGENT_UNIVERSAL_PROMPT,
      active: true,
      checksum: promptChecksum(MTR_AGENT_UNIVERSAL_PROMPT),
      createdBy: userId,
    },
  ];
}

async function seedRbacSubjects(db: Database, fixtureHash: string): Promise<void> {
  await db.execute(sql`update users set account_type=coalesce(account_type,'HUMAN'), auth_source=coalesce(auth_source,'DEMO') where id='demo-user-001'`);
  await db.execute(sql`insert into users (id,user_id,login,password_hash,display_name,roles,locale,is_synthetic_demo,created_by,status,account_type,auth_source) values
    ('demo-viewer-001','demo-viewer-001','viewer',${fixtureHash},'Наблюдатель проекта','["USER"]'::jsonb,'ru-RU',true,'demo-user-001','ACTIVE','HUMAN','DEMO'),
    ('demo-analyst-001','demo-analyst-001','analyst',${fixtureHash},'Аналитик МТР','["USER"]'::jsonb,'ru-RU',true,'demo-user-001','ACTIVE','HUMAN','DEMO'),
    ('demo-expert-001','demo-expert-001','expert',${fixtureHash},'Эксперт МТР','["USER"]'::jsonb,'ru-RU',true,'demo-user-001','ACTIVE','HUMAN','DEMO'),
    ('demo-director-001','demo-director-001','director',${fixtureHash},'Руководитель','["USER"]'::jsonb,'ru-RU',true,'demo-user-001','ACTIVE','HUMAN','DEMO'),
    ('demo-admin-001','demo-admin-001','admin',${fixtureHash},'Системный администратор','["ADMIN"]'::jsonb,'ru-RU',true,'demo-user-001','ACTIVE','HUMAN','DEMO'),
    ('demo-auditor-001','demo-auditor-001','auditor',${fixtureHash},'Аудитор','["ADMIN"]'::jsonb,'ru-RU',true,'demo-user-001','ACTIVE','HUMAN','DEMO'),
    ('demo-service-001','demo-service-001','integration-service',${fixtureHash},'Интеграционная служба','[]'::jsonb,'ru-RU',true,'demo-user-001','ACTIVE','SERVICE_ACCOUNT','DEMO')
    on conflict (id) do nothing`);
  await db.execute(sql`insert into project_memberships (project_id,user_id,status,added_by) values
    ('demo-project-001','demo-user-001','ACTIVE','demo-user-001'),('demo-project-001','demo-viewer-001','ACTIVE','demo-user-001'),('demo-project-001','demo-analyst-001','ACTIVE','demo-user-001'),('demo-project-001','demo-expert-001','ACTIVE','demo-user-001'),('demo-project-001','demo-director-001','ACTIVE','demo-user-001'),('demo-project-001','demo-auditor-001','ACTIVE','demo-user-001') on conflict do nothing`);
  await db.execute(sql`insert into role_assignments (id,user_id,role_id,scope_type,project_id,status,assigned_by) values
    ('assign-demo-admin','demo-user-001','role-system-admin','GLOBAL',null,'ACTIVE','demo-user-001'),('assign-demo-manager','demo-user-001','role-project-manager','PROJECT','demo-project-001','ACTIVE','demo-user-001'),
    ('assign-viewer','demo-viewer-001','role-project-viewer','PROJECT','demo-project-001','ACTIVE','demo-user-001'),('assign-analyst','demo-analyst-001','role-mtr-analyst','PROJECT','demo-project-001','ACTIVE','demo-user-001'),('assign-expert','demo-expert-001','role-mtr-expert','PROJECT','demo-project-001','ACTIVE','demo-user-001'),('assign-director','demo-director-001','role-project-viewer','PROJECT','demo-project-001','ACTIVE','demo-user-001'),
    ('assign-admin','demo-admin-001','role-system-admin','GLOBAL',null,'ACTIVE','demo-user-001'),('assign-auditor-global','demo-auditor-001','role-auditor','GLOBAL',null,'ACTIVE','demo-user-001'),('assign-auditor-project','demo-auditor-001','role-project-viewer','PROJECT','demo-project-001','ACTIVE','demo-user-001'),('assign-service','demo-service-001','role-integration-service','SERVICE',null,'ACTIVE','demo-user-001') on conflict do nothing`);
  await ensureDemoWarehouseAccessClaims(db);
}

async function ensureDemoWarehouseAccessClaims(db: Database): Promise<number> {
  const warehouseIds = [...new Set(sapFixture.materials.map((item) => item.warehouse))];
  const stockUsers = [
    "demo-user-001",
    "demo-analyst-001",
    "demo-expert-001",
    "demo-director-001",
  ] as const;
  const before = await countDemoWarehouseAccessClaims(db, stockUsers);
  for (const stockUserId of stockUsers) {
    for (const warehouseId of warehouseIds) {
      await db.execute(sql`insert into user_source_access_claims
        (id,user_id,claim_type,claim_value,source)
        values (${`claim-${stockUserId}-${warehouseId.toLocaleLowerCase("en-US")}`},${stockUserId},'warehouseIds',${warehouseId},'DEMO_SEED')
        on conflict (user_id,claim_type,claim_value,source) do nothing`);
    }
  }
  const after = await countDemoWarehouseAccessClaims(db, stockUsers);
  const expected = stockUsers.length * warehouseIds.length;
  if (after !== expected) {
    throw new Error(
      `Проверка складских access-claims не пройдена: ожидалось ${expected}, получено ${after}.`,
    );
  }
  return Math.max(0, after - before);
}

async function countDemoWarehouseAccessClaims(
  db: Database,
  stockUsers: readonly [string, string, string, string],
): Promise<number> {
  const result = await db.execute(sql`
    select count(*)::int as value
    from user_source_access_claims
    where claim_type='warehouseIds'
      and source='DEMO_SEED'
      and user_id in (${stockUsers[0]},${stockUsers[1]},${stockUsers[2]},${stockUsers[3]})
  `);
  return Number(extractExecutedRows(result)[0]?.value ?? 0);
}

function requiredDemoPasswordHash(): string {
  const fixtureHash = process.env.DEMO_PASSWORD_HASH?.trim();
  if (!fixtureHash?.startsWith("scrypt$")) {
    throw new Error("DEMO_PASSWORD_HASH обязателен для создания demo-персон");
  }
  return fixtureHash;
}

function buildMaterialMovementRows(): Array<typeof materialMovements.$inferInsert> {
  const anchor = new Date("2026-08-10T09:00:00.000Z");
  return sapFixture.materials.flatMap((material, materialIndex) =>
    Array.from({ length: 12 }, (_, weekIndex) => {
      const occurredAt = new Date(anchor);
      occurredAt.setUTCDate(anchor.getUTCDate() - (11 - weekIndex) * 7);
      const ingestedAt = occurredAt.toISOString();
      const consumption = 1 + (materialIndex % 7) + (weekIndex % 3);
      return {
        id: `movement-${material.recordId}-${String(weekIndex + 1).padStart(2, "0")}`,
        tenantId: "demo-tenant-001",
        projectId: "demo-project-001",
        sourceScopeId: "demo-sap-001",
        materialCode: material.materialCode,
        plant: material.plant,
        storageLocation: material.warehouse,
        movementType: "CONSUMPTION",
        quantity: decimal(consumption),
        unit: material.unit,
        occurredAt: ingestedAt,
        sourceDocumentId: `SAP-DEMO-MOVEMENT-${materialIndex + 1}-${weekIndex + 1}`,
        snapshotVersion: `sap-movements-2026-w${String(weekIndex + 1).padStart(2, "0")}`,
        idempotencyKey: `movement:${material.recordId}:${weekIndex + 1}`,
        attributes: { syntheticDemo: true, historyWeek: weekIndex + 1 },
        authorizationVersion: 1,
        roleAssignmentSnapshot: ["assign-demo-manager"],
        ingestedAt,
        retentionUntil: oneCalendarYearAfter(ingestedAt),
      };
    }),
  );
}

function buildProcessMetricEventRows(): Array<typeof agentMetricEvents.$inferInsert> {
  const anchor = new Date("2026-08-10T12:00:00.000Z");
  return Array.from({ length: 12 }, (_, weekIndex) => {
    const occurredAt = new Date(anchor);
    occurredAt.setUTCDate(anchor.getUTCDate() - (11 - weekIndex) * 7);
    const timestamp = occurredAt.toISOString();
    const aggregateId = `demo-process-week-${String(weekIndex + 1).padStart(2, "0")}`;
    const common = {
      tenantId: "demo-tenant-001",
      projectId: "demo-project-001",
      actorUserId: DEMO_USER_ID,
      eventVersion: 1,
      aggregateType: "RUN" as const,
      occurredAt: timestamp,
      correlationId: `metric-week-${weekIndex + 1}`,
      sourceVersion: "scenario-metrics-v1",
      authorizationVersion: 1,
      roleAssignmentSnapshot: ["assign-demo-manager"],
      ingestedAt: timestamp,
      retentionUntil: oneCalendarYearAfter(timestamp),
    };
    const started = 8 + (weekIndex % 3);
    const completed = started - (weekIndex % 4 === 0 ? 1 : 0);
    const review = 2 + (weekIndex % 2);
    return [
      {
        ...common,
        id: `metric-${aggregateId}-started`,
        eventType: "ANALYSIS_STARTED",
        aggregateId: `${aggregateId}-started`,
        attributes: { count: started, syntheticDemo: true },
        idempotencyKey: `${aggregateId}:started`,
      },
      {
        ...common,
        id: `metric-${aggregateId}-completed`,
        eventType: "ANALYSIS_COMPLETED",
        aggregateId: `${aggregateId}-completed`,
        attributes: { count: completed, cycleTimeMs: 10_800_000 + weekIndex * 120_000, syntheticDemo: true },
        idempotencyKey: `${aggregateId}:completed`,
      },
      {
        ...common,
        id: `metric-${aggregateId}-review`,
        eventType: "EXPERT_TASK_ASSIGNED",
        aggregateId: `${aggregateId}-review`,
        attributes: { count: review, syntheticDemo: true },
        idempotencyKey: `${aggregateId}:review`,
      },
    ];
  }).flat();
}

export async function deleteUserScopedRows(
  db: Database,
  userId: string,
  includeUser = false,
): Promise<void> {
  // Child-to-parent order keeps the reset portable with FK enforcement on.
  const demoTenantId = "demo-tenant-001";
  await deleteUniversalChatDatasetRows(db, userId);
  await db.delete(agentLearningCandidates).where(eq(agentLearningCandidates.tenantId, demoTenantId));
  await db.delete(agentActionProposals).where(eq(agentActionProposals.tenantId, demoTenantId));
  await db.delete(agentTasks).where(eq(agentTasks.tenantId, demoTenantId));
  await db.delete(agentProactiveInsights).where(eq(agentProactiveInsights.tenantId, demoTenantId));
  await db.delete(agentEvidenceFacts).where(eq(agentEvidenceFacts.tenantId, demoTenantId));
  await db.delete(agentPlanExecutions).where(eq(agentPlanExecutions.tenantId, demoTenantId));
  await db.delete(agentCases).where(eq(agentCases.tenantId, demoTenantId));
  await db.delete(agentEventInbox).where(eq(agentEventInbox.tenantId, demoTenantId));
  await db.delete(agentMetricEvents).where(eq(agentMetricEvents.tenantId, demoTenantId));
  await db.delete(materialMovements).where(eq(materialMovements.tenantId, demoTenantId));
  await db.delete(agentCitations).where(eq(agentCitations.userId, userId));
  await db.delete(agentMessages).where(eq(agentMessages.userId, userId));
  await db.delete(agentThreads).where(eq(agentThreads.userId, userId));
  // Scenario templates and Appius fixtures are shared by the demo project.
  // Remove project runtime children for every project member before replacing
  // those shared parents; otherwise an analyst-owned run would block reset via
  // foreign keys and leave a half-reset database.
  await db.execute(sql`
    delete from analysis_review_decisions
    where run_id in (select id from scenario_runs where project_id='demo-project-001')
  `);
  await db.execute(sql`
    delete from position_analysis_results
    where run_id in (select id from scenario_runs where project_id='demo-project-001')
  `);
  await db.execute(sql`
    delete from scenario_run_steps
    where run_id in (select id from scenario_runs where project_id='demo-project-001')
  `);
  await db.execute(sql`
    delete from audit_logs
    where entity_type='SCENARIO_RUN'
      and entity_id in (select id from scenario_runs where project_id='demo-project-001')
  `);
  await db.execute(sql`delete from scenario_runs where project_id='demo-project-001'`);
  await db.delete(analysisReviewDecisions).where(eq(analysisReviewDecisions.userId, userId));
  await db.delete(positionAnalysisResults).where(eq(positionAnalysisResults.userId, userId));
  await db.delete(scenarioRunSteps).where(eq(scenarioRunSteps.userId, userId));
  await db.delete(scenarioRuns).where(eq(scenarioRuns.userId, userId));
  await db.delete(uploadedFiles).where(eq(uploadedFiles.userId, userId));
  await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
  await db.delete(promptVersions).where(eq(promptVersions.userId, userId));
  await db.delete(dictionaries).where(eq(dictionaries.userId, userId));
  await db.delete(scenarios).where(eq(scenarios.userId, userId));
  await db.delete(integrationStates).where(eq(integrationStates.userId, userId));
  await db.delete(responsibilityRules).where(eq(responsibilityRules.userId, userId));
  await db.delete(analogueRules).where(eq(analogueRules.userId, userId));
  await db.delete(normativeChunks).where(eq(normativeChunks.userId, userId));
  await db.delete(normativeDocuments).where(eq(normativeDocuments.userId, userId));
  await db.delete(sapStockBalances).where(eq(sapStockBalances.userId, userId));
  await db.delete(sapMaterials).where(eq(sapMaterials.userId, userId));
  await db.delete(specificationPositions).where(eq(specificationPositions.userId, userId));
  await db.delete(specificationVersions).where(eq(specificationVersions.userId, userId));
  await db.delete(specifications).where(eq(specifications.userId, userId));
  if (includeUser) {
    await db.delete(authSessions).where(eq(authSessions.userId, userId));
    await db.delete(users).where(and(eq(users.id, userId), eq(users.userId, userId)));
  }
}

function validateFixtures(): void {
  const portfolioFixture = generateSpecificationPortfolio();
  const validations: Array<[label: string, actual: number, expected: number]> = [
    ["identity.users", identityFixture.users.length, identityFixture.fixtureManifest.expectedUserCount],
    [
      "appius.specifications",
      appiusFixture.specifications.length,
      appiusFixture.fixtureManifest.expectedSpecificationCount,
    ],
    [
      "appius.positions",
      appiusFixture.positions.length,
      appiusFixture.fixtureManifest.expectedCanonicalPositionCount,
    ],
    [
      "appiusPortfolio.specifications",
      portfolioFixture.specifications.length,
      SPECIFICATION_PORTFOLIO_MANIFEST.expectedSpecificationCount,
    ],
    [
      "appiusPortfolio.versions",
      portfolioFixture.specificationVersions.length,
      SPECIFICATION_PORTFOLIO_MANIFEST.expectedVersionCount,
    ],
    [
      "appiusPortfolio.positions",
      portfolioFixture.positions.length,
      SPECIFICATION_PORTFOLIO_MANIFEST.expectedPositionCount,
    ],
    ["sap.materials", sapFixture.materials.length, sapFixture.fixtureManifest.expectedMaterialStockRecordCount],
    [
      "normative.documents",
      normativeFixture.documents.length,
      normativeFixture.fixtureManifest.expectedDocumentCount,
    ],
    [
      "normative.responsibilityRules",
      normativeFixture.responsibilityRules.length,
      normativeFixture.fixtureManifest.expectedResponsibilityRuleCount,
    ],
    [
      "normative.analogueRules",
      normativeFixture.analogueRules.length,
      normativeFixture.fixtureManifest.expectedAnalogueRuleCount,
    ],
    ["scenarios.scenarios", scenariosFixture.scenarios.length, scenariosFixture.fixtureManifest.expectedScenarioCount],
  ];
  const errors = validations.flatMap(([label, actual, expected]) =>
    actual === expected ? [] : [`${label}: ожидалось ${expected}, получено ${actual}`],
  );

  const ownerIds = [
    ...identityFixture.users.map((item) => item.user_id),
    ...appiusFixture.specifications.map((item) => item.user_id),
    ...appiusFixture.specificationVersions.map((item) => item.user_id),
    ...appiusFixture.positions.map((item) => item.user_id),
    ...portfolioFixture.specifications.map((item) => item.user_id),
    ...portfolioFixture.specificationVersions.map((item) => item.user_id),
    ...portfolioFixture.positions.map((item) => item.user_id),
    ...sapFixture.materials.map((item) => item.user_id),
    ...normativeFixture.documents.map((item) => item.user_id),
    ...normativeFixture.chunks.map((item) => item.user_id),
    ...normativeFixture.responsibilityRules.map((item) => item.user_id),
    ...normativeFixture.analogueRules.map((item) => item.user_id),
    ...scenariosFixture.scenarios.map((item) => item.user_id),
  ];
  if (ownerIds.some((ownerId) => ownerId !== DEMO_USER_ID)) {
    errors.push("fixture содержит владельца, отличного от demo-user-001");
  }
  if (new Set(sapFixture.materials.map((item) => item.materialCode)).size !== sapFixture.materials.length) {
    errors.push("коды материалов SAP должны быть уникальны");
  }
  if (new Set(appiusFixture.positions.map((item) => item.id)).size !== appiusFixture.positions.length) {
    errors.push("идентификаторы канонических позиций Appius должны быть уникальны");
  }
  if (errors.length > 0) throw new Error(`Fixture validation failed: ${errors.join("; ")}.`);
}

function buildIntegrationRows(userId: string): Array<typeof integrationStates.$inferInsert> {
  return [
    {
      userId,
      system: "APPIUS",
      state: appiusFixture.integrationState.state,
      delayMs: appiusFixture.integrationState.delayMs,
      lastSynchronizedAt: appiusFixture.integrationState.lastSynchronizedAt,
      settings: { supportedStates: appiusFixture.integrationState.supportedStates },
      createdBy: userId,
    },
    {
      userId,
      system: "SAP",
      state: sapFixture.integrationState.state,
      delayMs: sapFixture.integrationState.delayMs,
      snapshotAt: sapFixture.integrationState.snapshotDate,
      lastSynchronizedAt: sapFixture.integrationState.lastSynchronizedAt,
      settings: {
        snapshotId: sapFixture.fixtureManifest.snapshotId,
        supportedStates: sapFixture.integrationState.supportedStates,
      },
      createdBy: userId,
    },
    {
      userId,
      system: "RAG",
      state: "AVAILABLE",
      delayMs: 0,
      lastSynchronizedAt: "2026-08-11T08:00:00.000Z",
      settings: { fixtureId: normativeFixture.fixtureManifest.fixtureId },
      createdBy: userId,
    },
    {
      userId,
      system: "LLM",
      state: "AVAILABLE",
      delayMs: 0,
      settings: { provider: "mock", deterministic: true },
      createdBy: userId,
    },
  ];
}

function deriveAnaloguePairs(equipmentType: string): {
  standards: Array<[string, string]>;
  materials: Array<[string, string]>;
} {
  const required = appiusFixture.positions.filter(
    (position) =>
      position.equipmentType === equipmentType &&
      scenariosFixture.scenarios.some(
        (scenario) => "targetPositionIds" in scenario && scenario.targetPositionIds?.includes(position.id),
      ),
  );
  const candidates = sapFixture.materials.filter(
    (material) => material.equipmentType === equipmentType && material.fixtureTags.includes("case:analogue"),
  );
  const standards = new Map<string, [string, string]>();
  const materials = new Map<string, [string, string]>();
  for (const position of required) {
    for (const candidate of candidates) {
      const standardPair: [string, string] = [position.standard, candidate.standard];
      standards.set(standardPair.join("\u0000"), standardPair);
      const materialPair: [string, string] = [position.materialGrade, candidate.materialGrade];
      materials.set(materialPair.join("\u0000"), materialPair);
    }
  }
  return { standards: [...standards.values()], materials: [...materials.values()] };
}

function deriveDimensionTolerances(
  equipmentType: string,
  criteria: Record<string, unknown>,
): Record<string, number> {
  const required = appiusFixture.positions.find(
    (position) =>
      position.equipmentType === equipmentType &&
      scenariosFixture.scenarios.some(
        (scenario) => "targetPositionIds" in scenario && scenario.targetPositionIds?.includes(position.id),
      ),
  );
  if (!required) return {};

  const percentKeys: Record<string, string> = {
    flowM3h: "flowPercent",
    headM: "headPercent",
    powerKw: "powerPercent",
    voltageV: "voltagePercent",
    speedRpm: "speedPercent",
    wallThicknessMm: "wallThicknessPercent",
  };
  const exactKeys: Record<string, string> = {
    connectionDnMm: "connectionDiameterMm",
    inletDiameterMm: "inletDiameterMm",
    outletDiameterMm: "outletDiameterMm",
  };
  const tolerances: Record<string, number> = {};
  for (const [dimension, value] of Object.entries(required.dimensions)) {
    if (typeof value !== "number") continue;
    const percent = criteria[percentKeys[dimension]];
    if (typeof percent === "number") {
      tolerances[dimension] = Math.abs(value) * (percent / 100);
      continue;
    }
    const exact = criteria[exactKeys[dimension] ?? dimension];
    if (typeof exact === "number") tolerances[dimension] = exact;
  }
  return tolerances;
}

function scenarioKind(id: string):
  | "FULL"
  | "STOCK_ONLY"
  | "SAP_FAILURE"
  | "APPIUS_NEW_VERSION"
  | "COMPOSITE_ANALOGUE" {
  if (id.includes("stock-search")) return "STOCK_ONLY";
  if (id.includes("sap-failure")) return "SAP_FAILURE";
  if (id.includes("appius-new-version")) return "APPIUS_NEW_VERSION";
  if (id.includes("composite-analogues")) return "COMPOSITE_ANALOGUE";
  return "FULL";
}

function matchesExpectedCounts(counts: SeedCounts): boolean {
  const exactBaselineIsPresent = EXACT_BASELINE_COUNT_KEYS.every(
    (key) => counts[key] === EXPECTED_BASE_COUNTS[key],
  );
  const minimumBaselineIsPresent = MINIMUM_BASELINE_COUNT_KEYS.every(
    (key) => counts[key] >= EXPECTED_BASE_COUNTS[key],
  );
  return exactBaselineIsPresent && minimumBaselineIsPresent;
}

function matchesLegacySpecificationPortfolioCounts(counts: SeedCounts): boolean {
  const legacyExactCounts = {
    ...EXPECTED_BASE_COUNTS,
    specifications: appiusFixture.fixtureManifest.expectedSpecificationCount,
    canonicalPositions: appiusFixture.fixtureManifest.expectedCanonicalPositionCount,
  };
  const exactLegacyBaselineIsPresent = EXACT_BASELINE_COUNT_KEYS.every(
    (key) => counts[key] === legacyExactCounts[key],
  );
  return (
    exactLegacyBaselineIsPresent &&
    counts.users >= EXPECTED_BASE_COUNTS.users &&
    counts.specificationVersions >= appiusFixture.specificationVersions.length &&
    counts.prompts >= EXPECTED_BASE_COUNTS.prompts
  );
}

function matchesAdditiveBaseUpgradeCandidate(counts: SeedCounts): boolean {
  const stableKeys = EXACT_BASELINE_COUNT_KEYS.filter(
    (key) => key !== "specifications" && key !== "canonicalPositions",
  );
  const stableBaselineIsPresent = stableKeys.every(
    (key) => counts[key] === EXPECTED_BASE_COUNTS[key],
  );
  const legacyPortfolioIsPresent =
    counts.specifications === appiusFixture.fixtureManifest.expectedSpecificationCount &&
    counts.canonicalPositions === appiusFixture.fixtureManifest.expectedCanonicalPositionCount &&
    counts.specificationVersions >= appiusFixture.specificationVersions.length;
  const targetPortfolioIsPresent =
    counts.specifications === EXPECTED_BASE_COUNTS.specifications &&
    counts.canonicalPositions === EXPECTED_BASE_COUNTS.canonicalPositions &&
    counts.specificationVersions >= EXPECTED_BASE_COUNTS.specificationVersions;
  return (
    stableBaselineIsPresent &&
    counts.users >= EXPECTED_BASE_COUNTS.users &&
    counts.prompts >= EXPECTED_BASE_COUNTS.prompts &&
    (legacyPortfolioIsPresent || targetPortfolioIsPresent)
  );
}

function assertEmptyOrExpectedCounts<TCounts extends Record<string, number>>(
  label: string,
  actual: TCounts,
  expected: { readonly [Key in keyof TCounts]: number },
): void {
  const values = Object.values(actual);
  const isEmpty = values.every((value) => value === 0);
  const isExpected = Object.entries(expected).every(
    ([key, value]) => actual[key as keyof TCounts] === value,
  );
  if (!isEmpty && !isExpected) {
    throw new Error(
      `Аддитивное обновление остановлено: частично заполненный набор ${label} не изменён (${JSON.stringify(actual)}).`,
    );
  }
}

function formatSeedCounts(counts: SeedCounts): string {
  return Object.entries(counts)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

function assertDemoUser(userId: string): asserts userId is typeof DEMO_USER_ID {
  if (userId !== DEMO_USER_ID) {
    throw new Error("Канонический seed разрешён только для доверенного пользователя demo-user-001.");
  }
}

function accessAttributes(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return { ...value };
  return value === undefined ? {} : { level: value };
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function scalarRecord(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string | number | boolean | null] =>
        entry[1] === null || ["string", "number", "boolean"].includes(typeof entry[1]),
    ),
  );
}

function decimal(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Fixture содержит некорректное числовое значение.");
  return value.toFixed(3);
}

function isoDate(value: string): string {
  return value.includes("T") ? value : `${value}T00:00:00.000Z`;
}

function oneCalendarYearAfter(value: string): string {
  const date = new Date(value);
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString();
}

function naturalDocumentKey(documentId: string, version: string): string {
  return `${documentId}\u0000${version}`;
}

function naturalClauseKey(documentId: string, version: string, clauseId: string): string {
  return `${naturalDocumentKey(documentId, version)}\u0000${clauseId}`;
}

function requireDocumentId(
  lookup: Map<string, string>,
  documentId: string,
  version: string,
): string {
  const id = lookup.get(naturalDocumentKey(documentId, version));
  if (!id) throw new Error(`Для нормативной ссылки ${documentId} / ${version} не найден документ.`);
  return id;
}

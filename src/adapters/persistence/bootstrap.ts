import { createHash } from "node:crypto";

import { and, count, eq, sql } from "drizzle-orm";

import appiusFixture from "@/adapters/mock/fixtures/appius.json";
import identityFixture from "@/adapters/mock/fixtures/identity.json";
import normativeFixture from "@/adapters/mock/fixtures/normative.json";
import sapFixture from "@/adapters/mock/fixtures/sap.json";
import scenariosFixture from "@/adapters/mock/fixtures/scenarios.json";
import { DEMO_USER_ID } from "@/domain/models";

import { type Database, getDatabase, isRemoteDatabaseConfigured } from "./db";
import { createReadinessCache } from "./readiness-cache";
import {
  agentCitations,
  agentMessages,
  agentThreads,
  analogueRules,
  auditLogs,
  authSessions,
  dictionaries,
  integrationStates,
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

export const EXPECTED_BASE_COUNTS = {
  users: 7,
  specifications: 3,
  specificationVersions: 8,
  canonicalPositions: 24,
  sapMaterials: 30,
  sapBalances: 30,
  normativeDocuments: 4,
  normativeChunks: 16,
  responsibilityRules: 5,
  analogueRules: 3,
  integrations: 4,
  scenarios: 5,
  prompts: 1,
  dictionaries: 7,
} as const;

export type SeedCounts = { [Key in keyof typeof EXPECTED_BASE_COUNTS]: number };

interface DatabaseInitializationResult {
  seeded: boolean;
  counts: SeedCounts;
}

// Deduplicates concurrent/repeated login bootstrap attempts while remaining
// bounded. Authenticated runtime reads never enter this destructive readiness
// boundary; health/count endpoints still query exact data, and reset/seed
// invalidate this entry immediately.
const READINESS_CACHE_TTL_MS = 5 * 60_000;
const EXACT_BASELINE_COUNT_KEYS = [
  "users",
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
const MUTABLE_RUNTIME_COUNT_KEYS = [
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

export const INITIAL_AGENT_PROMPT = [
  "Ты — проектный AI-агент прототипа анализа МТР.",
  "Используй только факты, полученные через серверные инструменты Appius, SAP и нормативного поиска.",
  "Не придумывай остатки, версии, нормативные пункты или персональные данные.",
  "Каждый существенный вывод сопровождай ссылкой на источник и явно отмечай необходимость экспертной проверки.",
].join("\n");

/** Login/CLI bootstrap boundary: migrates and repairs a missing canonical seed. */
export async function initializeDatabase(): Promise<DatabaseInitializationResult> {
  validateFixtures();
  const db = await getDatabase({ migrations: "ensure" });
  const result = await databaseReadinessCache.resolve(db, async () => {
    const current = await getSeedCounts(db, DEMO_USER_ID);
    if (matchesExpectedCounts(current)) return { seeded: false, counts: current };

    const counts = await seedDatabaseUncached(DEMO_USER_ID, db);
    return { seeded: true, counts };
  });
  return { seeded: result.seeded, counts: { ...result.counts } };
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
  const globalUserCount = await countRows(db, users);
  const mismatches = Object.entries(EXPECTED_BASE_COUNTS).flatMap(([key, expected]) => {
    const actual = counts[key as keyof SeedCounts];
    return actual === expected ? [] : [`${key}: ожидалось ${expected}, получено ${actual}`];
  });
  if (globalUserCount !== EXPECTED_BASE_COUNTS.users) {
    mismatches.push(
      `users (глобально): ожидалось ${EXPECTED_BASE_COUNTS.users}, получено ${globalUserCount}`,
    );
  }
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

async function insertFixtureRows(db: Database, userId: string): Promise<void> {
  const fixtureUser = identityFixture.users[0];
  const userValues = {
    id: userId,
    userId,
    login: "demo",
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

  await seedRbacSubjects(db);

  await db.insert(specifications).values(
    appiusFixture.specifications.map((item) => ({
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
  );

  const historicByVersion = new Map(
    appiusFixture.historicSnapshots.map((snapshot) => [snapshot.versionId, asJsonRecord(snapshot)]),
  );
  await db.insert(specificationVersions).values(
    appiusFixture.specificationVersions.map((item) => ({
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
  );

  await db.insert(specificationPositions).values(
    appiusFixture.positions.map((item) => ({
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

  await db.insert(promptVersions).values({
    id: "prompt-mtr-agent-001",
    userId,
    name: "mtr-project-agent",
    promptVersion: "1.0.0",
    content: INITIAL_AGENT_PROMPT,
    active: true,
    checksum: createHash("sha256").update(INITIAL_AGENT_PROMPT, "utf8").digest("hex"),
    createdBy: userId,
  });

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

async function seedRbacSubjects(db: Database): Promise<void> {
  const fixtureHash = "scrypt$16384$8$1$bXRyLWRlbW8tYXV0aC12MQ$GcR_B-AFou6BJpPfLHVa0afwkfnOh5_ehbSyTSL2TFn7UARDrszHNcwtC19lk40LVfg7sGA_roL4NX7hUkexBA";
  await db.execute(sql`update users set password_hash=coalesce(password_hash,${fixtureHash}), account_type=coalesce(account_type,'HUMAN'), auth_source=coalesce(auth_source,'DEMO') where id='demo-user-001'`);
  await db.execute(sql`insert into users (id,user_id,login,password_hash,display_name,roles,locale,is_synthetic_demo,created_by,status,account_type,auth_source) values
    ('demo-viewer-001','demo-viewer-001','viewer',${fixtureHash},'Наблюдатель проекта','["USER"]'::jsonb,'ru-RU',true,'demo-user-001','ACTIVE','HUMAN','DEMO'),
    ('demo-analyst-001','demo-analyst-001','analyst',${fixtureHash},'Аналитик МТР','["USER"]'::jsonb,'ru-RU',true,'demo-user-001','ACTIVE','HUMAN','DEMO'),
    ('demo-expert-001','demo-expert-001','expert',${fixtureHash},'Эксперт МТР','["USER"]'::jsonb,'ru-RU',true,'demo-user-001','ACTIVE','HUMAN','DEMO'),
    ('demo-admin-001','demo-admin-001','admin',${fixtureHash},'Системный администратор','["ADMIN"]'::jsonb,'ru-RU',true,'demo-user-001','ACTIVE','HUMAN','DEMO'),
    ('demo-auditor-001','demo-auditor-001','auditor',${fixtureHash},'Аудитор','["ADMIN"]'::jsonb,'ru-RU',true,'demo-user-001','ACTIVE','HUMAN','DEMO'),
    ('demo-service-001','demo-service-001','integration-service',${fixtureHash},'Интеграционная служба','[]'::jsonb,'ru-RU',true,'demo-user-001','ACTIVE','SERVICE_ACCOUNT','DEMO')
    on conflict (id) do nothing`);
  await db.execute(sql`insert into project_memberships (project_id,user_id,status,added_by) values
    ('demo-project-001','demo-user-001','ACTIVE','demo-user-001'),('demo-project-001','demo-viewer-001','ACTIVE','demo-user-001'),('demo-project-001','demo-analyst-001','ACTIVE','demo-user-001'),('demo-project-001','demo-expert-001','ACTIVE','demo-user-001'),('demo-project-001','demo-auditor-001','ACTIVE','demo-user-001') on conflict do nothing`);
  await db.execute(sql`insert into role_assignments (id,user_id,role_id,scope_type,project_id,status,assigned_by) values
    ('assign-demo-admin','demo-user-001','role-system-admin','GLOBAL',null,'ACTIVE','demo-user-001'),('assign-demo-manager','demo-user-001','role-project-manager','PROJECT','demo-project-001','ACTIVE','demo-user-001'),
    ('assign-viewer','demo-viewer-001','role-project-viewer','PROJECT','demo-project-001','ACTIVE','demo-user-001'),('assign-analyst','demo-analyst-001','role-mtr-analyst','PROJECT','demo-project-001','ACTIVE','demo-user-001'),('assign-expert','demo-expert-001','role-mtr-expert','PROJECT','demo-project-001','ACTIVE','demo-user-001'),
    ('assign-admin','demo-admin-001','role-system-admin','GLOBAL',null,'ACTIVE','demo-user-001'),('assign-auditor-global','demo-auditor-001','role-auditor','GLOBAL',null,'ACTIVE','demo-user-001'),('assign-auditor-project','demo-auditor-001','role-project-viewer','PROJECT','demo-project-001','ACTIVE','demo-user-001'),('assign-service','demo-service-001','role-integration-service','SERVICE',null,'ACTIVE','demo-user-001') on conflict do nothing`);
}

export async function deleteUserScopedRows(
  db: Database,
  userId: string,
  includeUser = false,
): Promise<void> {
  // Child-to-parent order keeps the reset portable with FK enforcement on.
  await db.delete(agentCitations).where(eq(agentCitations.userId, userId));
  await db.delete(agentMessages).where(eq(agentMessages.userId, userId));
  await db.delete(agentThreads).where(eq(agentThreads.userId, userId));
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

async function countRows(
  db: Database,
  table:
    | typeof users
    | typeof specifications
    | typeof specificationVersions
    | typeof specificationPositions
    | typeof sapMaterials
    | typeof sapStockBalances
    | typeof normativeDocuments
    | typeof normativeChunks
    | typeof responsibilityRules
    | typeof analogueRules
    | typeof integrationStates
    | typeof scenarios
    | typeof promptVersions
    | typeof dictionaries,
  filter?: ReturnType<typeof eq>,
): Promise<number> {
  const query = db.select({ value: count() }).from(table);
  const rows = filter ? await query.where(filter) : await query;
  return Number(rows[0]?.value ?? 0);
}

function matchesExpectedCounts(counts: SeedCounts): boolean {
  const exactBaselineIsPresent = EXACT_BASELINE_COUNT_KEYS.every(
    (key) => counts[key] === EXPECTED_BASE_COUNTS[key],
  );
  const mutableRuntimeIsValid = MUTABLE_RUNTIME_COUNT_KEYS.every(
    (key) => counts[key] >= EXPECTED_BASE_COUNTS[key],
  );
  return exactBaselineIsPresent && mutableRuntimeIsValid;
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

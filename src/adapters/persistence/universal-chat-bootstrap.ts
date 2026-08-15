import { and, eq, sql } from "drizzle-orm";

import { generateIndustrialCatalogue } from "@/adapters/mock/fixtures/industrial-catalogue";
import { generateUniversalChatDataset } from "@/adapters/mock/fixtures/universal-chat-dataset";
import {
  createSystemScenarioClock,
  type ScenarioClock,
} from "@/domain/agent/universal-chat/scenario-clock";
import { DEMO_USER_ID } from "@/domain/models";

import { type Database, getDatabase, isRemoteDatabaseConfigured } from "./db";
import {
  businessProjectDeadlines,
  businessProjectPositions,
  businessProjectSpecifications,
  businessProjects,
  catalogItems,
  operationalMaterialViews,
  projectMaterialAllocations,
  specificationIntakeItems,
  users,
} from "./schema";

const TENANT_ID = "demo-tenant-001";
const ACCESS_PROJECT_ID = "demo-project-001";
const CATALOG_SCOPE_ID = "demo-catalog-001";
const SOURCE_SCOPE_ID = "demo-sap-001";
const DATASET_ID = "universal-chat-v1";
const DATASET_VERSION = "1.0.0-DEMO";
const PERSISTED_DATASET_VERSION = `${DATASET_ID}@${DATASET_VERSION}`;
const INSERT_BATCH_SIZE = 50;

export const EXPECTED_UNIVERSAL_CHAT_COUNTS = {
  businessProjects: 22,
  businessProjectDeadlines: 66,
  businessProjectSpecifications: 83,
  operationalMaterialViews: 4_800,
  businessProjectPositions: 3_584,
  specificationIntakeItems: 83,
  projectMaterialAllocations: 3_571,
} as const;

export type UniversalChatCounts = {
  [Key in keyof typeof EXPECTED_UNIVERSAL_CHAT_COUNTS]: number;
};

export async function seedUniversalChatDataset(
  userId: string = DEMO_USER_ID,
  database?: Database,
  clock: ScenarioClock = createSystemScenarioClock(),
): Promise<UniversalChatCounts> {
  assertDemoUser(userId);
  const db = database ?? (await getDatabase({ migrations: "ensure" }));
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.userId, userId)))
    .limit(1);
  if (!owner) throw new Error("UNIVERSAL_CHAT_OWNER_MISSING");
  const [{ catalogItemCount = 0 } = {}] = extractRows(await db.execute(sql`
    select count(*)::int as "catalogItemCount"
    from ${catalogItems}
    where ${catalogItems.userId}=${userId}
  `));
  if (Number(catalogItemCount) !== 4_800) {
    throw new Error("UNIVERSAL_CHAT_CATALOG_NOT_READY");
  }

  const dataset = generateUniversalChatDataset(clock);
  const catalogue = generateIndustrialCatalogue();
  const catalogItemIdByCode = new Map(
    catalogue.items.map((item) => [item.itemCode, item.id]),
  );
  const materialViewIdByCode = new Map(
    dataset.operationalMaterials.map((material) => [
      material.materialCode,
      operationalMaterialViewId(material.catalogItemCode),
    ]),
  );

  await db.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    if (isRemoteDatabaseConfigured()) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`mtr-universal-chat:${userId}`}))`,
      );
    }
    await deleteUniversalChatDatasetRows(tx, userId);
    await insertBatches(
      tx,
      businessProjects,
      dataset.businessProjects.map((project) => ({
        id: project.id,
        tenantId: TENANT_ID,
        accessProjectId: project.accessProjectId,
        code: project.code,
        name: project.name,
        aliases: [...project.aliases],
        externalProjectCodes: [...project.externalProjectCodes],
        status: project.status,
        phase: project.phase,
        needDate: project.needDate,
        datasetVersion: PERSISTED_DATASET_VERSION,
        scenarioTimeZone: dataset.manifest.timeZone,
        isSyntheticDemo: true,
        createdBy: userId,
      })),
    );
    await insertBatches(
      tx,
      businessProjectDeadlines,
      dataset.businessProjects.flatMap((project) =>
        project.deadlines.map((deadline) => ({
          id: deadline.id,
          tenantId: TENANT_ID,
          businessProjectId: project.id,
          kind: deadline.kind,
          dueAt: deadline.dueAt,
          daysFromScenarioToday: deadline.daysFromScenarioToday,
          status: deadline.status,
          datasetVersion: PERSISTED_DATASET_VERSION,
          createdBy: userId,
        }))),
    );
    await insertBatches(
      tx,
      businessProjectSpecifications,
      dataset.specificationLinks.map((link) => ({
        id: businessSpecificationLinkId(link.specificationId),
        tenantId: TENANT_ID,
        accessProjectId: link.accessProjectId,
        businessProjectId: link.businessProjectId,
        ownerUserId: userId,
        specificationId: link.specificationId,
        currentVersionId: link.currentVersionId,
        sourceProjectCode: link.sourceProjectCode,
        purpose: link.purpose,
        name: link.name,
        datasetVersion: PERSISTED_DATASET_VERSION,
        createdBy: userId,
      })),
    );
    await insertBatches(
      tx,
      operationalMaterialViews,
      dataset.operationalMaterials.map((material) => {
        const catalogItemId = catalogItemIdByCode.get(material.catalogItemCode);
        if (!catalogItemId) {
          throw new Error(`UNIVERSAL_CHAT_CATALOG_ITEM_ID_MISSING:${material.catalogItemCode}`);
        }
        return {
          id: operationalMaterialViewId(material.catalogItemCode),
          tenantId: TENANT_ID,
          accessProjectId: ACCESS_PROJECT_ID,
          ownerUserId: userId,
          catalogScopeId: CATALOG_SCOPE_ID,
          sourceScopeId: SOURCE_SCOPE_ID,
          catalogItemId,
          materialCode: material.materialCode,
          sourceKind: material.sourceKind,
          equipmentType: material.equipmentType,
          itemKind: material.itemKind,
          familyId: material.familyId,
          unit: material.unit,
          packSize: material.packSize,
          leadTimeDays: material.leadTimeDays,
          safetyStock: material.safetyStock,
          stock: material.stock,
          inboundSupplies: [...material.inboundSupplies],
          weeklyMovements: [...material.weeklyMovements],
          reliability: material.reliability,
          asOf: dataset.manifest.asOf,
          datasetVersion: PERSISTED_DATASET_VERSION,
          isSyntheticDemo: true,
          createdBy: userId,
        };
      }),
    );
    await insertBatches(
      tx,
      businessProjectPositions,
      dataset.positionLinks.map((link) => {
        const catalogItemId = catalogItemIdByCode.get(link.catalogItemCode);
        const operationalMaterialViewIdValue = materialViewIdByCode.get(
          link.operationalMaterialCode,
        );
        if (!catalogItemId || !operationalMaterialViewIdValue) {
          throw new Error(`UNIVERSAL_CHAT_POSITION_TARGET_MISSING:${link.positionId}`);
        }
        return {
          id: `business-position-${link.positionId}`,
          tenantId: TENANT_ID,
          accessProjectId: ACCESS_PROJECT_ID,
          businessProjectId: link.businessProjectId,
          ownerUserId: userId,
          specificationLinkId: businessSpecificationLinkId(link.specificationId),
          positionId: link.positionId,
          catalogItemId,
          operationalMaterialViewId: operationalMaterialViewIdValue,
          mappingKind: link.mappingKind,
          projectAssociationConfidencePercent: link.projectAssociationConfidencePercent,
          equipmentType: link.equipmentType,
          sourceRequiredQuantity: decimal(link.sourceRequiredQuantity),
          sourceUnit: link.sourceUnit,
          requiredQuantity: decimal(link.requiredQuantity),
          unit: link.unit,
          datasetVersion: PERSISTED_DATASET_VERSION,
          createdBy: userId,
        };
      }),
    );
    await insertBatches(
      tx,
      specificationIntakeItems,
      dataset.specificationIntakes.map((item) => ({
        id: item.id,
        tenantId: TENANT_ID,
        accessProjectId: ACCESS_PROJECT_ID,
        businessProjectId: item.businessProjectId,
        ownerUserId: userId,
        specificationLinkId: businessSpecificationLinkId(item.specificationId),
        specificationId: item.specificationId,
        versionId: item.versionId,
        fileId: item.fileId,
        receivedAt: item.receivedAt,
        validationStartedAt: item.validationStartedAt,
        validationFinishedAt: item.validationFinishedAt,
        queuedAt: item.queuedAt,
        processingStartedAt: item.processingStartedAt,
        processingFinishedAt: item.processingFinishedAt,
        status: item.status,
        currentStep: item.currentStep,
        assignedActorId: item.assignedActorId,
        taskId: item.taskId,
        runId: item.runId,
        eventIds: [...item.eventIds],
        safeErrorCategory: item.safeErrorCategory,
        slaDeadline: item.slaDeadline,
        intakeVersion: item.version,
        idempotencyKey: item.idempotencyKey,
        auditCorrelationId: item.auditCorrelationId,
        datasetVersion: PERSISTED_DATASET_VERSION,
        createdBy: userId,
      })),
    );
    await insertBatches(
      tx,
      projectMaterialAllocations,
      dataset.projectAllocations.map((allocation) => {
        const operationalMaterialViewIdValue = materialViewIdByCode.get(
          allocation.materialCode,
        );
        if (!operationalMaterialViewIdValue) {
          throw new Error(`UNIVERSAL_CHAT_ALLOCATION_TARGET_MISSING:${allocation.id}`);
        }
        return {
          id: allocation.id,
          tenantId: TENANT_ID,
          accessProjectId: ACCESS_PROJECT_ID,
          businessProjectId: allocation.businessProjectId,
          operationalMaterialViewId: operationalMaterialViewIdValue,
          snapshotId: allocation.snapshotId,
          materialCode: allocation.materialCode,
          quantity: decimal(allocation.quantity),
          unit: allocation.unit,
          allocationVersion: allocation.allocationVersion,
          datasetVersion: PERSISTED_DATASET_VERSION,
          createdBy: userId,
        };
      }),
    );
  });
  return assertUniversalChatCounts(db);
}

export async function ensureUniversalChatDataset(
  userId: string = DEMO_USER_ID,
  database?: Database,
  clock: ScenarioClock = createSystemScenarioClock(),
): Promise<{ seeded: boolean; counts: UniversalChatCounts }> {
  assertDemoUser(userId);
  const db = database ?? (await getDatabase({ migrations: "ensure" }));
  const counts = await getUniversalChatCounts(db);
  if (matchesExpectedCounts(counts)) return { seeded: false, counts };
  return { seeded: true, counts: await seedUniversalChatDataset(userId, db, clock) };
}

export async function getUniversalChatCounts(
  database: Database,
): Promise<UniversalChatCounts> {
  const result = await database.execute(sql`
    select
      (select count(*)::int from ${businessProjects} where ${businessProjects.tenantId}=${TENANT_ID} and ${businessProjects.datasetVersion}=${PERSISTED_DATASET_VERSION}) as "businessProjects",
      (select count(*)::int from ${businessProjectDeadlines} where ${businessProjectDeadlines.tenantId}=${TENANT_ID} and ${businessProjectDeadlines.datasetVersion}=${PERSISTED_DATASET_VERSION}) as "businessProjectDeadlines",
      (select count(*)::int from ${businessProjectSpecifications} where ${businessProjectSpecifications.tenantId}=${TENANT_ID} and ${businessProjectSpecifications.datasetVersion}=${PERSISTED_DATASET_VERSION}) as "businessProjectSpecifications",
      (select count(*)::int from ${operationalMaterialViews} where ${operationalMaterialViews.tenantId}=${TENANT_ID} and ${operationalMaterialViews.datasetVersion}=${PERSISTED_DATASET_VERSION}) as "operationalMaterialViews",
      (select count(*)::int from ${businessProjectPositions} where ${businessProjectPositions.tenantId}=${TENANT_ID} and ${businessProjectPositions.datasetVersion}=${PERSISTED_DATASET_VERSION}) as "businessProjectPositions",
      (select count(*)::int from ${specificationIntakeItems} where ${specificationIntakeItems.tenantId}=${TENANT_ID} and ${specificationIntakeItems.datasetVersion}=${PERSISTED_DATASET_VERSION}) as "specificationIntakeItems",
      (select count(*)::int from ${projectMaterialAllocations} where ${projectMaterialAllocations.tenantId}=${TENANT_ID} and ${projectMaterialAllocations.datasetVersion}=${PERSISTED_DATASET_VERSION}) as "projectMaterialAllocations"
  `);
  const row = extractRows(result)[0];
  if (!row) throw new Error("UNIVERSAL_CHAT_COUNT_QUERY_EMPTY");
  return Object.fromEntries(
    Object.keys(EXPECTED_UNIVERSAL_CHAT_COUNTS).map((key) => [key, Number(row[key] ?? 0)]),
  ) as UniversalChatCounts;
}

export async function assertUniversalChatCounts(
  database: Database,
): Promise<UniversalChatCounts> {
  const counts = await getUniversalChatCounts(database);
  const mismatches = Object.entries(EXPECTED_UNIVERSAL_CHAT_COUNTS).flatMap(
    ([key, expected]) => {
      const actual = counts[key as keyof UniversalChatCounts];
      return actual === expected ? [] : [`${key}: expected ${expected}, actual ${actual}`];
    },
  );
  if (mismatches.length > 0) {
    throw new Error(`UNIVERSAL_CHAT_COUNT_MISMATCH:${mismatches.join(";")}`);
  }
  return counts;
}

export async function deleteUniversalChatDatasetRows(
  database: Database,
  userId: string = DEMO_USER_ID,
): Promise<void> {
  assertDemoUser(userId);
  await database.delete(projectMaterialAllocations).where(eq(projectMaterialAllocations.tenantId, TENANT_ID));
  await database.delete(specificationIntakeItems).where(eq(specificationIntakeItems.tenantId, TENANT_ID));
  await database.delete(businessProjectPositions).where(eq(businessProjectPositions.tenantId, TENANT_ID));
  await database.delete(operationalMaterialViews).where(eq(operationalMaterialViews.tenantId, TENANT_ID));
  await database.delete(businessProjectSpecifications).where(eq(businessProjectSpecifications.tenantId, TENANT_ID));
  await database.delete(businessProjectDeadlines).where(eq(businessProjectDeadlines.tenantId, TENANT_ID));
  await database.delete(businessProjects).where(eq(businessProjects.tenantId, TENANT_ID));
}

export function universalChatDatasetEnabled(): boolean {
  return process.env.MTR_AGENT_UNIVERSAL_CHAT_ENABLED === "true";
}

async function insertBatches<
  TTable extends Parameters<Database["insert"]>[0],
  TRow extends object,
>(database: Database, table: TTable, rows: readonly TRow[]): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + INSERT_BATCH_SIZE);
    if (batch.length > 0) await database.insert(table).values(batch as never);
  }
}

function matchesExpectedCounts(counts: UniversalChatCounts): boolean {
  return Object.entries(EXPECTED_UNIVERSAL_CHAT_COUNTS).every(
    ([key, expected]) => counts[key as keyof UniversalChatCounts] === expected,
  );
}

function businessSpecificationLinkId(specificationId: string): string {
  return `business-specification-${specificationId}`;
}

function operationalMaterialViewId(catalogItemCode: string): string {
  return `operational-${catalogItemCode.toLocaleLowerCase("en-US")}`;
}

function decimal(value: number): string {
  return value.toFixed(3);
}

function assertDemoUser(userId: string): void {
  if (userId !== DEMO_USER_ID) throw new Error("UNIVERSAL_CHAT_DEMO_SCOPE_REQUIRED");
}

function extractRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) {
    return result.rows as Array<Record<string, unknown>>;
  }
  return [];
}

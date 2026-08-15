import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  type SQL,
} from "drizzle-orm";

import { getDatabase, type Database } from "@/adapters/persistence/db";
import {
  agentTasks,
  businessProjectDeadlines,
  businessProjectPositions,
  businessProjectSpecifications,
  businessProjects,
  catalogBomComponents,
  catalogItems,
  operationalMaterialViews,
  projectMaterialAllocations,
  scenarioRuns,
  specificationIntakeItems,
  specificationVersions,
} from "@/adapters/persistence/schema";
import type { AgentExecutionContext } from "@/domain/agent/context";
import type {
  BusinessProject,
  SpecificationIntakeItem,
} from "@/domain/agent/universal-chat/dataset";
import type {
  UniversalAccessScope,
  UniversalAgentReadPort,
  UniversalAllocationRecord,
  UniversalBomComponentRecord,
  UniversalMaterialRecord,
  UniversalPositionRecord,
  UniversalSpecificationRecord,
  UniversalSpecificationVersionRecord,
  UniversalRunRecord,
  UniversalTaskRecord,
} from "@/ports/universal-agent";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

export function createUniversalAgentReadPort(database?: Database): UniversalAgentReadPort {
  const dbPromise = database ? Promise.resolve(database) : getDatabase({ migrations: "skip" });
  return {
    async listProjects(context, scope, query = {}) {
      assertProjectScope(context, scope);
      const db = await dbPromise;
      const conditions: SQL[] = [
        eq(businessProjects.tenantId, scope.tenantId),
        eq(businessProjects.accessProjectId, scope.accessProjectId),
      ];
      if (query.statuses?.length) conditions.push(inArray(businessProjects.status, [...query.statuses]));
      if (query.dueBefore) conditions.push(lte(businessProjects.needDate, query.dueBefore));
      const rows = await db.select().from(businessProjects)
        .where(and(...conditions))
        .orderBy(asc(businessProjects.needDate), asc(businessProjects.code))
        .limit(limit(query.limit));
      if (rows.length === 0) return [];
      const deadlines = await db.select().from(businessProjectDeadlines).where(and(
        eq(businessProjectDeadlines.tenantId, scope.tenantId),
        inArray(businessProjectDeadlines.businessProjectId, rows.map((row) => row.id)),
      )).orderBy(asc(businessProjectDeadlines.dueAt));
      return rows.map((row): BusinessProject => ({
        id: row.id,
        accessProjectId: row.accessProjectId as "demo-project-001",
        code: row.code,
        name: row.name,
        aliases: row.aliases,
        externalProjectCodes: row.externalProjectCodes,
        status: row.status as BusinessProject["status"],
        phase: row.phase as BusinessProject["phase"],
        needDate: row.needDate,
        deadlines: deadlines.filter((deadline) => deadline.businessProjectId === row.id).map((deadline) => ({
          id: deadline.id,
          kind: deadline.kind as BusinessProject["deadlines"][number]["kind"],
          dueAt: deadline.dueAt,
          daysFromScenarioToday: deadline.daysFromScenarioToday,
          status: deadline.status as BusinessProject["deadlines"][number]["status"],
        })),
        isSyntheticDemo: true,
      }));
    },

    async listSpecifications(context, scope, query = {}) {
      assertProjectScope(context, scope);
      const db = await dbPromise;
      const conditions: SQL[] = [
        eq(businessProjectSpecifications.tenantId, scope.tenantId),
        eq(businessProjectSpecifications.accessProjectId, scope.accessProjectId),
      ];
      if (query.businessProjectId) {
        conditions.push(eq(businessProjectSpecifications.businessProjectId, query.businessProjectId));
      }
      if (query.purpose) conditions.push(eq(businessProjectSpecifications.purpose, query.purpose));
      if (query.text) {
        const pattern = `%${escapeLike(query.text)}%`;
        conditions.push(or(
          ilike(businessProjectSpecifications.name, pattern),
          ilike(businessProjectSpecifications.specificationId, pattern),
          ilike(businessProjectSpecifications.sourceProjectCode, pattern),
        )!);
      }
      const rows = await db.select().from(businessProjectSpecifications)
        .where(and(...conditions))
        .orderBy(asc(businessProjectSpecifications.name), asc(businessProjectSpecifications.id))
        .limit(limit(query.limit));
      return rows.map((row): UniversalSpecificationRecord => ({
        id: row.id,
        specificationId: row.specificationId,
        currentVersionId: row.currentVersionId,
        businessProjectId: row.businessProjectId,
        code: row.specificationId,
        name: row.name,
        aliases: [row.sourceProjectCode, row.specificationId, row.name],
        purpose: row.purpose as UniversalSpecificationRecord["purpose"],
        datasetVersion: row.datasetVersion,
      }));
    },

    async listSpecificationVersions(context, scope, specificationId) {
      assertProjectScope(context, scope);
      const db = await dbPromise;
      const rows = await db.select().from(specificationVersions).where(and(
        eq(specificationVersions.userId, scope.subjectId),
        eq(specificationVersions.projectId, scope.accessProjectId),
        eq(specificationVersions.specificationId, specificationId),
      )).orderBy(desc(specificationVersions.versionNumber));
      return rows.map((row): UniversalSpecificationVersionRecord => ({
        id: row.id,
        specificationId: row.specificationId,
        versionNumber: row.versionNumber,
        isCurrent: row.isCurrent,
        status: row.status,
        effectiveAt: row.effectiveAt,
        positionCount: row.positionCount,
        sourceFileName: row.sourceFileName,
      }));
    },

    async listPositions(context, scope, query) {
      assertProjectScope(context, scope);
      const db = await dbPromise;
      const conditions: SQL[] = [
        eq(businessProjectPositions.tenantId, scope.tenantId),
        eq(businessProjectPositions.accessProjectId, scope.accessProjectId),
      ];
      if (query.businessProjectId) conditions.push(eq(businessProjectPositions.businessProjectId, query.businessProjectId));
      if (query.specificationId) {
        conditions.push(eq(businessProjectSpecifications.specificationId, query.specificationId));
      }
      if (query.positionId) conditions.push(eq(businessProjectPositions.positionId, query.positionId));
      if (query.equipmentType) conditions.push(eq(businessProjectPositions.equipmentType, query.equipmentType));
      if (query.materialCode) conditions.push(eq(operationalMaterialViews.materialCode, query.materialCode));
      const rows = await db.select({
        id: businessProjectPositions.id,
        positionId: businessProjectPositions.positionId,
        specificationId: businessProjectSpecifications.specificationId,
        businessProjectId: businessProjectPositions.businessProjectId,
        catalogItemId: businessProjectPositions.catalogItemId,
        materialViewId: businessProjectPositions.operationalMaterialViewId,
        materialCode: operationalMaterialViews.materialCode,
        equipmentType: businessProjectPositions.equipmentType,
        requiredQuantity: businessProjectPositions.requiredQuantity,
        unit: businessProjectPositions.unit,
        confidence: businessProjectPositions.projectAssociationConfidencePercent,
      }).from(businessProjectPositions)
        .innerJoin(businessProjectSpecifications, and(
          eq(businessProjectSpecifications.tenantId, businessProjectPositions.tenantId),
          eq(businessProjectSpecifications.id, businessProjectPositions.specificationLinkId),
        ))
        .innerJoin(operationalMaterialViews, and(
          eq(operationalMaterialViews.tenantId, businessProjectPositions.tenantId),
          eq(operationalMaterialViews.id, businessProjectPositions.operationalMaterialViewId),
        ))
        .where(and(...conditions))
        .orderBy(asc(businessProjectPositions.positionId))
        .limit(limit(query.limit))
        .offset(offset(query.offset));
      return rows.map((row): UniversalPositionRecord => ({
        id: row.id,
        positionId: row.positionId,
        specificationId: row.specificationId,
        businessProjectId: row.businessProjectId,
        catalogItemId: row.catalogItemId,
        materialViewId: row.materialViewId,
        materialCode: row.materialCode,
        equipmentType: row.equipmentType,
        requiredQuantity: Number(row.requiredQuantity),
        unit: row.unit,
        projectAssociationConfidencePercent: row.confidence,
      }));
    },

    async listIntakes(context, scope, query) {
      assertProjectScope(context, scope);
      const db = await dbPromise;
      const conditions: SQL[] = [
        eq(specificationIntakeItems.tenantId, scope.tenantId),
        eq(specificationIntakeItems.accessProjectId, scope.accessProjectId),
      ];
      if (query.businessProjectId) conditions.push(eq(specificationIntakeItems.businessProjectId, query.businessProjectId));
      if (query.statuses?.length) conditions.push(inArray(specificationIntakeItems.status, [...query.statuses]));
      if (query.receivedFrom) conditions.push(gte(specificationIntakeItems.receivedAt, query.receivedFrom));
      if (query.receivedTo) conditions.push(lte(specificationIntakeItems.receivedAt, query.receivedTo));
      const rows = await db.select().from(specificationIntakeItems)
        .where(and(...conditions))
        .orderBy(asc(specificationIntakeItems.receivedAt), asc(specificationIntakeItems.id))
        .limit(limit(query.limit));
      return rows.map((row): SpecificationIntakeItem => ({
        id: row.id,
        specificationId: row.specificationId,
        versionId: row.versionId,
        fileId: row.fileId,
        businessProjectId: row.businessProjectId,
        receivedAt: row.receivedAt,
        validationStartedAt: row.validationStartedAt,
        validationFinishedAt: row.validationFinishedAt,
        queuedAt: row.queuedAt,
        processingStartedAt: row.processingStartedAt,
        processingFinishedAt: row.processingFinishedAt,
        status: row.status as SpecificationIntakeItem["status"],
        currentStep: row.currentStep,
        assignedActorId: row.assignedActorId,
        taskId: row.taskId,
        runId: row.runId,
        eventIds: row.eventIds,
        safeErrorCategory: row.safeErrorCategory as SpecificationIntakeItem["safeErrorCategory"],
        slaDeadline: row.slaDeadline,
        version: row.intakeVersion,
        idempotencyKey: row.idempotencyKey,
        auditCorrelationId: row.auditCorrelationId,
      }));
    },

    async searchMaterials(context, scope, query) {
      assertMaterialScope(context, scope);
      const db = await dbPromise;
      const conditions: SQL[] = [
        eq(operationalMaterialViews.tenantId, scope.tenantId),
        eq(operationalMaterialViews.accessProjectId, scope.accessProjectId),
        inArray(operationalMaterialViews.catalogScopeId, [...scope.catalogScopeIds]),
        inArray(operationalMaterialViews.sourceScopeId, [...scope.sourceScopeIds]),
      ];
      if (query.materialCode) conditions.push(eq(operationalMaterialViews.materialCode, query.materialCode));
      if (query.materialCodes?.length) {
        conditions.push(inArray(operationalMaterialViews.materialCode, [...query.materialCodes]));
      }
      if (query.equipmentType) conditions.push(eq(operationalMaterialViews.equipmentType, query.equipmentType));
      if (query.familyId) conditions.push(eq(operationalMaterialViews.familyId, query.familyId));
      if (query.itemKind) conditions.push(eq(operationalMaterialViews.itemKind, query.itemKind));
      if (query.text) {
        const pattern = `%${escapeLike(query.text)}%`;
        conditions.push(or(
          ilike(operationalMaterialViews.materialCode, pattern),
          ilike(catalogItems.itemCode, pattern),
          ilike(catalogItems.legacyCode, pattern),
          ilike(catalogItems.manufacturerPartNumber, pattern),
          ilike(catalogItems.nameRu, pattern),
          ilike(catalogItems.nameEn, pattern),
        )!);
      }
      const rows = await db.select({
        view: operationalMaterialViews,
        item: catalogItems,
      }).from(operationalMaterialViews)
        .innerJoin(catalogItems, and(
          eq(catalogItems.userId, operationalMaterialViews.ownerUserId),
          eq(catalogItems.id, operationalMaterialViews.catalogItemId),
        ))
        .where(and(...conditions))
        .orderBy(asc(operationalMaterialViews.materialCode))
        .limit(limit(query.limit))
        .offset(offset(query.offset));
      return rows.map(({ view, item }): UniversalMaterialRecord => ({
        id: view.id,
        materialCode: view.materialCode,
        catalogItemId: item.id,
        catalogItemCode: item.itemCode,
        legacyCode: item.legacyCode ?? "",
        manufacturerPartNumber: item.manufacturerPartNumber ?? "",
        nameRu: item.nameRu,
        nameEn: item.nameEn ?? "",
        aliases: [item.itemCode, item.legacyCode, item.manufacturerPartNumber, item.nameEn, ...item.synonyms]
          .filter((value): value is string => Boolean(value)),
        equipmentType: view.equipmentType,
        itemKind: view.itemKind as UniversalMaterialRecord["itemKind"],
        familyId: view.familyId,
        manufacturer: item.manufacturer ?? "",
        standard: item.standard ?? "",
        materialGrade: item.materialGrade ?? "",
        characteristics: item.characteristics,
        compatibilityStatus: String(item.characteristics.compatibilityStatus) as UniversalMaterialRecord["compatibilityStatus"],
        unit: view.unit,
        packSize: view.packSize,
        leadTimeDays: view.leadTimeDays,
        safetyStock: view.safetyStock,
        stock: scopedStock(view.stock, scope.warehouseIds),
        inboundSupplies: view.inboundSupplies,
        weeklyMovements: view.weeklyMovements,
        reliability: view.reliability,
        sourceKind: view.sourceKind as UniversalMaterialRecord["sourceKind"],
        sourceScopeId: view.sourceScopeId,
        catalogScopeId: view.catalogScopeId,
        asOf: view.asOf,
        datasetVersion: view.datasetVersion,
      }));
    },

    async listAllocations(context, scope, query) {
      assertProjectScope(context, scope);
      const db = await dbPromise;
      const conditions: SQL[] = [
        eq(projectMaterialAllocations.tenantId, scope.tenantId),
        eq(projectMaterialAllocations.accessProjectId, scope.accessProjectId),
      ];
      if (query.businessProjectId) conditions.push(eq(projectMaterialAllocations.businessProjectId, query.businessProjectId));
      if (query.materialCode) conditions.push(eq(projectMaterialAllocations.materialCode, query.materialCode));
      if (query.materialCodes?.length) conditions.push(inArray(projectMaterialAllocations.materialCode, [...query.materialCodes]));
      if (query.snapshotId) conditions.push(eq(projectMaterialAllocations.snapshotId, query.snapshotId));
      const rows = await db.select().from(projectMaterialAllocations)
        .where(and(...conditions))
        .orderBy(asc(projectMaterialAllocations.businessProjectId), asc(projectMaterialAllocations.materialCode));
      return rows.map((row): UniversalAllocationRecord => ({
        businessProjectId: row.businessProjectId,
        materialCode: row.materialCode,
        snapshotId: row.snapshotId,
        quantity: Number(row.quantity),
        unit: row.unit,
      }));
    },

    async listBom(context, scope, assemblyMaterialCode) {
      assertMaterialScope(context, scope);
      const db = await dbPromise;
      const assemblyAlias = catalogItems;
      const rows = await db.select({
        positionNumber: catalogBomComponents.positionNumber,
        quantity: catalogBomComponents.quantity,
        unit: catalogBomComponents.unit,
        isCritical: catalogBomComponents.isCritical,
        alternativeFamilyId: catalogBomComponents.alternativeFamilyId,
        assemblyMaterialCode: operationalMaterialViews.materialCode,
        componentCatalogItemId: catalogBomComponents.componentItemId,
      }).from(catalogBomComponents)
        .innerJoin(assemblyAlias, and(
          eq(assemblyAlias.userId, catalogBomComponents.userId),
          eq(assemblyAlias.id, catalogBomComponents.assemblyItemId),
        ))
        .innerJoin(operationalMaterialViews, and(
          eq(operationalMaterialViews.ownerUserId, assemblyAlias.userId),
          eq(operationalMaterialViews.catalogItemId, assemblyAlias.id),
          eq(operationalMaterialViews.tenantId, scope.tenantId),
          eq(operationalMaterialViews.accessProjectId, scope.accessProjectId),
          inArray(operationalMaterialViews.catalogScopeId, [...scope.catalogScopeIds]),
        ))
        .where(and(
          eq(operationalMaterialViews.materialCode, assemblyMaterialCode),
          inArray(operationalMaterialViews.sourceScopeId, [...scope.sourceScopeIds]),
        ))
        .orderBy(asc(catalogBomComponents.positionNumber));
      if (rows.length === 0) return [];
      const componentViews = await db.select({
        catalogItemId: operationalMaterialViews.catalogItemId,
        materialCode: operationalMaterialViews.materialCode,
      }).from(operationalMaterialViews).where(and(
        eq(operationalMaterialViews.tenantId, scope.tenantId),
        inArray(operationalMaterialViews.catalogItemId, rows.map((row) => row.componentCatalogItemId)),
      ));
      const materialByItemId = new Map(componentViews.map((row) => [row.catalogItemId, row.materialCode]));
      return rows.flatMap((row): UniversalBomComponentRecord[] => {
        const componentMaterialCode = materialByItemId.get(row.componentCatalogItemId);
        return componentMaterialCode ? [{
          assemblyMaterialCode: row.assemblyMaterialCode,
          componentMaterialCode,
          positionNumber: row.positionNumber,
          quantity: Number(row.quantity),
          unit: row.unit,
          isCritical: row.isCritical,
          alternativeFamilyId: row.alternativeFamilyId ?? "",
        }] : [];
      });
    },

    async listRuns(context, scope, query = {}) {
      assertProjectScope(context, scope);
      const db = await dbPromise;
      const conditions: SQL[] = [
        eq(scenarioRuns.userId, scope.subjectId),
        eq(scenarioRuns.projectId, scope.accessProjectId),
      ];
      if (query.specificationIds?.length) {
        conditions.push(inArray(scenarioRuns.specificationId, [...query.specificationIds]));
      }
      if (query.statuses?.length) {
        conditions.push(inArray(
          scenarioRuns.status,
          [...query.statuses] as Array<typeof scenarioRuns.$inferSelect.status>,
        ));
      }
      const rows = await db.select().from(scenarioRuns)
        .where(and(...conditions))
        .orderBy(desc(scenarioRuns.createdAt), desc(scenarioRuns.id))
        .limit(limit(query.limit));
      return rows.map((row): UniversalRunRecord => ({
        id: row.id,
        specificationId: row.specificationId,
        status: row.status,
        currentStep: row.currentStep,
        progress: row.progress,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        errorCode: row.errorCode,
        createdAt: row.createdAt,
      }));
    },

    async listTasks(context, scope, query = {}) {
      assertProjectScope(context, scope);
      const db = await dbPromise;
      const conditions: SQL[] = [
        eq(agentTasks.tenantId, scope.tenantId),
        eq(agentTasks.projectId, scope.accessProjectId),
      ];
      if (query.assigneeUserId) conditions.push(eq(agentTasks.assigneeUserId, query.assigneeUserId));
      if (query.statuses?.length) conditions.push(inArray(agentTasks.status, [...query.statuses]));
      const rows = await db.select().from(agentTasks)
        .where(and(...conditions))
        .orderBy(desc(agentTasks.updatedAt), asc(agentTasks.id))
        .limit(limit(query.limit));
      return rows.map((row): UniversalTaskRecord => ({
        id: row.id,
        assigneeUserId: row.assigneeUserId,
        kind: row.kind,
        status: row.status,
        priority: row.priority,
        title: row.title,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        dueAt: row.dueAt,
        updatedAt: row.updatedAt,
      }));
    },
  };
}

function assertProjectScope(context: AgentExecutionContext, scope: UniversalAccessScope): void {
  if (
    context.trusted.subjectId !== scope.subjectId ||
    context.trusted.activeProjectId !== scope.accessProjectId ||
    context.trusted.authorizationVersion !== scope.authorizationVersion
  ) {
    throw new Error("UNIVERSAL_SCOPE_STALE");
  }
}

function assertMaterialScope(context: AgentExecutionContext, scope: UniversalAccessScope): void {
  assertProjectScope(context, scope);
  if (
    scope.catalogScopeIds.length === 0 ||
    scope.sourceScopeIds.length === 0 ||
    scope.warehouseIds.length === 0
  ) {
    throw new Error("UNIVERSAL_SOURCE_SCOPE_REQUIRED");
  }
}

function scopedStock(
  stock: UniversalMaterialRecord["stock"],
  warehouseIds: readonly string[],
): UniversalMaterialRecord["stock"] {
  const allowed = new Set(warehouseIds);
  const balances = stock.balances.filter((balance) => allowed.has(balance.warehouseId));
  return {
    ...stock,
    onHandQuantity: balances.reduce((total, balance) => total + balance.onHandQuantity, 0),
    reservedQuantity: balances.reduce((total, balance) => total + balance.reservedQuantity, 0),
    quarantinedQuantity: balances.reduce((total, balance) => total + balance.quarantinedQuantity, 0),
    balances,
  };
}

function limit(value: number | undefined): number {
  return Math.max(1, Math.min(MAX_LIMIT, value ?? DEFAULT_LIMIT));
}

function offset(value: number | undefined): number {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value! : 0;
}

function escapeLike(value: string): string {
  return value.trim().replace(/[\\%_]/gu, (character) => `\\${character}`);
}

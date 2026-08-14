import type { AgentExecutionContext } from "@/domain/agent/context";
import type {
  BusinessProject,
  OperationalInboundSupply,
  OperationalStockView,
  ReliabilityProfile,
  SpecificationIntakeItem,
  SpecificationPurpose,
  WeeklyMaterialMovement,
} from "@/domain/agent/universal-chat/dataset";
import type { CatalogueCharacteristicValue } from "@/domain/catalogue";

export interface UniversalAccessScope {
  readonly tenantId: "demo-tenant-001";
  readonly subjectId: string;
  readonly accessProjectId: string;
  readonly catalogScopeIds: readonly string[];
  readonly sourceScopeIds: readonly string[];
  readonly warehouseIds: readonly string[];
  readonly authorizationVersion: number;
}

export interface UniversalSpecificationRecord {
  readonly id: string;
  readonly specificationId: string;
  readonly currentVersionId: string;
  readonly businessProjectId: string;
  readonly code: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly purpose: SpecificationPurpose;
  readonly datasetVersion: string;
}

export interface UniversalSpecificationVersionRecord {
  readonly id: string;
  readonly specificationId: string;
  readonly versionNumber: number;
  readonly isCurrent: boolean;
  readonly status: string;
  readonly effectiveAt: string;
  readonly positionCount: number;
  readonly sourceFileName: string | null;
}

export interface UniversalPositionRecord {
  readonly id: string;
  readonly positionId: string;
  readonly specificationId: string;
  readonly businessProjectId: string;
  readonly catalogItemId: string;
  readonly materialViewId: string;
  readonly materialCode: string;
  readonly equipmentType: string;
  readonly requiredQuantity: number;
  readonly unit: string;
  readonly projectAssociationConfidencePercent: number;
}

export interface UniversalMaterialRecord {
  readonly id: string;
  readonly materialCode: string;
  readonly catalogItemId: string;
  readonly catalogItemCode: string;
  readonly legacyCode: string;
  readonly manufacturerPartNumber: string;
  readonly nameRu: string;
  readonly nameEn: string;
  readonly aliases: readonly string[];
  readonly equipmentType: string;
  readonly itemKind: "COMPONENT" | "ASSEMBLY";
  readonly familyId: string | null;
  readonly manufacturer: string;
  readonly standard: string;
  readonly materialGrade: string;
  readonly characteristics: Readonly<Record<string, CatalogueCharacteristicValue>>;
  readonly compatibilityStatus: "VALID_MEMBER" | "INCOMPATIBLE_DECOY" | "NOT_APPLICABLE";
  readonly unit: string;
  readonly packSize: number;
  readonly leadTimeDays: number;
  readonly safetyStock: number;
  readonly stock: OperationalStockView;
  readonly inboundSupplies: readonly OperationalInboundSupply[];
  readonly weeklyMovements: readonly WeeklyMaterialMovement[];
  readonly reliability: ReliabilityProfile;
  readonly sourceKind: "SAP_BASE" | "CATALOG_NORMALIZED";
  readonly sourceScopeId: string;
  readonly catalogScopeId: string;
  readonly asOf: string;
  readonly datasetVersion: string;
}

export interface UniversalAllocationRecord {
  readonly businessProjectId: string;
  readonly materialCode: string;
  readonly snapshotId: string;
  readonly quantity: number;
  readonly unit: string;
}

export interface UniversalBomComponentRecord {
  readonly assemblyMaterialCode: string;
  readonly componentMaterialCode: string;
  readonly positionNumber: string;
  readonly quantity: number;
  readonly unit: string;
  readonly isCritical: boolean;
  readonly alternativeFamilyId: string;
}

export interface UniversalRunRecord {
  readonly id: string;
  readonly specificationId: string;
  readonly status: string;
  readonly currentStep: string;
  readonly progress: number;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly errorCode: string | null;
  readonly createdAt: string;
}

export interface UniversalTaskRecord {
  readonly id: string;
  readonly assigneeUserId: string;
  readonly kind: string;
  readonly status: string;
  readonly priority: string;
  readonly title: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly dueAt: string | null;
  readonly updatedAt: string;
}

export interface UniversalAgentReadPort {
  listProjects(
    context: AgentExecutionContext,
    scope: UniversalAccessScope,
    query?: Readonly<{ statuses?: readonly string[]; dueBefore?: string; limit?: number }>,
  ): Promise<readonly BusinessProject[]>;
  listSpecifications(
    context: AgentExecutionContext,
    scope: UniversalAccessScope,
    query?: Readonly<{ businessProjectId?: string; text?: string; purpose?: SpecificationPurpose; limit?: number }>,
  ): Promise<readonly UniversalSpecificationRecord[]>;
  listSpecificationVersions(
    context: AgentExecutionContext,
    scope: UniversalAccessScope,
    specificationId: string,
  ): Promise<readonly UniversalSpecificationVersionRecord[]>;
  listPositions(
    context: AgentExecutionContext,
    scope: UniversalAccessScope,
    query: Readonly<{
      businessProjectId?: string;
      specificationId?: string;
      positionId?: string;
      equipmentType?: string;
      materialCode?: string;
      limit?: number;
      offset?: number;
    }>,
  ): Promise<readonly UniversalPositionRecord[]>;
  listIntakes(
    context: AgentExecutionContext,
    scope: UniversalAccessScope,
    query: Readonly<{
      businessProjectId?: string;
      statuses?: readonly SpecificationIntakeItem["status"][];
      receivedFrom?: string;
      receivedTo?: string;
      limit?: number;
    }>,
  ): Promise<readonly SpecificationIntakeItem[]>;
  searchMaterials(
    context: AgentExecutionContext,
    scope: UniversalAccessScope,
    query: Readonly<{
      text?: string;
      materialCode?: string;
      materialCodes?: readonly string[];
      equipmentType?: string;
      familyId?: string;
      itemKind?: "COMPONENT" | "ASSEMBLY";
      limit?: number;
      offset?: number;
    }>,
  ): Promise<readonly UniversalMaterialRecord[]>;
  listAllocations(
    context: AgentExecutionContext,
    scope: UniversalAccessScope,
    query: Readonly<{ businessProjectId?: string; materialCode?: string; materialCodes?: readonly string[]; snapshotId?: string }>,
  ): Promise<readonly UniversalAllocationRecord[]>;
  listBom(
    context: AgentExecutionContext,
    scope: UniversalAccessScope,
    assemblyMaterialCode: string,
  ): Promise<readonly UniversalBomComponentRecord[]>;
  listRuns(
    context: AgentExecutionContext,
    scope: UniversalAccessScope,
    query?: Readonly<{
      specificationIds?: readonly string[];
      statuses?: readonly string[];
      limit?: number;
    }>,
  ): Promise<readonly UniversalRunRecord[]>;
  listTasks(
    context: AgentExecutionContext,
    scope: UniversalAccessScope,
    query?: Readonly<{
      assigneeUserId?: string;
      statuses?: readonly string[];
      limit?: number;
    }>,
  ): Promise<readonly UniversalTaskRecord[]>;
}

export function universalAccessScope(context: AgentExecutionContext): UniversalAccessScope {
  const accessProjectId = context.trusted.activeProjectId;
  if (!accessProjectId) throw new Error("UNIVERSAL_ACCESS_PROJECT_REQUIRED");
  return Object.freeze({
    tenantId: "demo-tenant-001",
    subjectId: context.trusted.subjectId,
    accessProjectId,
    catalogScopeIds: Object.freeze([...context.trusted.catalogScopeIds]),
    sourceScopeIds: Object.freeze([...context.trusted.sourceScopeIds]),
    warehouseIds: Object.freeze([...(context.trusted.accessClaims.warehouseIds ?? [])]),
    authorizationVersion: context.trusted.authorizationVersion,
  });
}

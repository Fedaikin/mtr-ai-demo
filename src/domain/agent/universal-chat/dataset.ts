import type {
  ProjectMaterialBalance,
  ProjectMaterialBalanceInputs,
} from "@/application/agent-orchestrator/universal-chat/project-stock-formulas";

export type BusinessProjectStatus = "PLANNED" | "ACTIVE" | "ON_HOLD" | "COMPLETED";
export type BusinessProjectPhase =
  | "DESIGN"
  | "PROCUREMENT"
  | "CONSTRUCTION"
  | "COMMISSIONING"
  | "OPERATIONS";
export type SpecificationPurpose = "CONSTRUCTION" | "MAINTENANCE" | "REPAIR" | "SPARES";
export type SpecificationIntakeStatus =
  | "RECEIVED"
  | "VALIDATING"
  | "QUEUED"
  | "PROCESSING"
  | "NEEDS_REVIEW"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface BusinessProjectDeadline {
  readonly id: string;
  readonly kind: "DESIGN_FREEZE" | "MATERIAL_NEED" | "START_UP";
  readonly dueAt: string;
  readonly daysFromScenarioToday: number;
  readonly status: "UPCOMING" | "AT_RISK" | "MET";
}

export interface BusinessProject {
  readonly id: string;
  readonly accessProjectId: "demo-project-001";
  readonly code: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly externalProjectCodes: readonly string[];
  readonly status: BusinessProjectStatus;
  readonly phase: BusinessProjectPhase;
  readonly needDate: string;
  readonly deadlines: readonly BusinessProjectDeadline[];
  readonly isSyntheticDemo: true;
}

export interface UniversalSpecificationLink {
  readonly specificationId: string;
  readonly currentVersionId: string;
  readonly currentVersionNumber: number;
  readonly accessProjectId: "demo-project-001";
  readonly businessProjectId: string;
  readonly sourceProjectCode: string;
  readonly purpose: SpecificationPurpose;
  readonly name: string;
}

export interface UniversalPositionLink {
  readonly positionId: string;
  readonly specificationId: string;
  readonly businessProjectId: string;
  readonly sourceInternalCode: string;
  readonly catalogItemCode: string;
  readonly operationalMaterialCode: string;
  readonly mappingKind: "DIRECT_CATALOG_CODE" | "NORMALIZED_LEGACY";
  readonly projectAssociationConfidencePercent: 100;
  readonly equipmentType: string;
  readonly sourceRequiredQuantity: number;
  readonly sourceUnit: string;
  readonly requiredQuantity: number;
  readonly unit: string;
}

export interface WeeklyMaterialMovement {
  readonly weekStart: string;
  readonly consumptionQuantity: number;
  readonly receiptQuantity: number;
  readonly transferInQuantity: number;
  readonly transferOutQuantity: number;
  readonly adjustmentQuantity: number;
  readonly unit: string;
  readonly sourceVersion: "universal-chat-movements-v1";
}

export interface OperationalStockView {
  readonly snapshotId: string;
  readonly snapshotAt: string;
  readonly onHandQuantity: number;
  readonly reservedQuantity: number;
  readonly quarantinedQuantity: number;
  readonly committedToOtherNeeds: number;
  readonly unit: string;
  readonly balances: readonly OperationalWarehouseBalance[];
}

export interface OperationalWarehouseBalance {
  readonly warehouseId: string;
  readonly plant: string;
  readonly onHandQuantity: number;
  readonly reservedQuantity: number;
  readonly quarantinedQuantity: number;
  readonly unit: string;
}

export interface OperationalInboundSupply {
  readonly id: string;
  readonly confirmedQuantity: number;
  readonly promisedAt: string;
  readonly leadTimeDays: number;
  readonly status: "CONFIRMED";
}

export interface ReliabilityProfile {
  readonly profileVersion: "reliability-profile-v1";
  readonly operatingHours: number;
  readonly mtbfHours: number;
  readonly failureCount: number;
  readonly qualityRejectionCount: number;
  readonly supplyRiskPercent: number;
  readonly observedAt: string;
  readonly sourceEvidenceIds: readonly string[];
}

export interface OperationalMaterialView {
  readonly materialCode: string;
  readonly catalogItemCode: string;
  readonly sourceKind: "SAP_BASE" | "CATALOG_NORMALIZED";
  readonly equipmentType: string;
  readonly itemKind: "COMPONENT" | "ASSEMBLY";
  readonly familyId: string | null;
  readonly unit: string;
  readonly packSize: number;
  readonly leadTimeDays: number;
  readonly safetyStock: number;
  readonly stock: OperationalStockView;
  readonly inboundSupplies: readonly OperationalInboundSupply[];
  readonly weeklyMovements: readonly WeeklyMaterialMovement[];
  readonly reliability: ReliabilityProfile;
}

export interface SpecificationIntakeItem {
  readonly id: string;
  readonly specificationId: string;
  readonly versionId: string;
  readonly fileId: string;
  readonly businessProjectId: string;
  readonly receivedAt: string;
  readonly validationStartedAt: string | null;
  readonly validationFinishedAt: string | null;
  readonly queuedAt: string | null;
  readonly processingStartedAt: string | null;
  readonly processingFinishedAt: string | null;
  readonly status: SpecificationIntakeStatus;
  readonly currentStep: string;
  readonly assignedActorId: string | null;
  readonly taskId: string | null;
  readonly runId: string | null;
  readonly eventIds: readonly string[];
  readonly safeErrorCategory: "SOURCE_UNAVAILABLE" | "VALIDATION_REQUIRED" | null;
  readonly slaDeadline: string;
  readonly version: number;
  readonly idempotencyKey: string;
  readonly auditCorrelationId: string;
}

export interface ProjectAllocation {
  readonly id: string;
  readonly snapshotId: string;
  readonly businessProjectId: string;
  readonly materialCode: string;
  readonly quantity: number;
  readonly unit: string;
  readonly allocationVersion: "project-allocation-v1";
}

export interface ProjectMaterialIndicators {
  readonly projectAssociationConfidencePercent: number;
  readonly technicalCompatibilityPercent: number | null;
  readonly quantityCoveragePercent: number;
  readonly dataConfidencePercent: number;
}

export interface ProjectMaterialOracle {
  readonly id: string;
  readonly businessProjectId: string;
  readonly materialCode: string;
  readonly needDate: string;
  readonly formulaVersion: "project-material-balance-v1";
  readonly inputs: ProjectMaterialBalanceInputs;
  readonly expected: ProjectMaterialBalance;
  readonly indicators: ProjectMaterialIndicators;
}

export interface UniversalChatReferenceProjects {
  readonly pipeRichProjectId: string;
  readonly maintenanceProjectId: string;
  readonly nearestDeadlineProjectId: string;
  readonly multiSpecificationProjectId: string;
  readonly shortageAnalogueProjectId: string;
  readonly noPipeProjectId: string;
}

export interface UniversalChatDatasetManifest {
  readonly datasetId: "universal-chat-v1";
  readonly schemaVersion: "1.0.0";
  readonly datasetVersion: "1.0.0-DEMO";
  readonly generatedAt: string;
  readonly asOf: string;
  readonly timeZone: "Europe/Moscow";
  readonly deterministicSeed: number;
  readonly sourceVersions: Readonly<Record<string, string>>;
  readonly expectedCounts: {
    readonly accessProjects: 1;
    readonly businessProjects: number;
    readonly specifications: 83;
    readonly currentPositions: 3_584;
    readonly catalogItems: 4_800;
    readonly operationalMaterials: 4_800;
    readonly specificationIntakes: 83;
    readonly movementWeeksPerUsedMaterial: 52;
  };
  readonly referenceProjectIds: UniversalChatReferenceProjects;
  readonly checksum: string;
  readonly isSyntheticDemo: true;
}

export interface UniversalChatDataset {
  readonly manifest: UniversalChatDatasetManifest;
  readonly businessProjects: readonly BusinessProject[];
  readonly specificationLinks: readonly UniversalSpecificationLink[];
  readonly positionLinks: readonly UniversalPositionLink[];
  readonly operationalMaterials: readonly OperationalMaterialView[];
  readonly specificationIntakes: readonly SpecificationIntakeItem[];
  readonly projectAllocations: readonly ProjectAllocation[];
  readonly projectMaterialOracles: readonly ProjectMaterialOracle[];
}

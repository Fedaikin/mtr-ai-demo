export type AnalyticalMovementType = "CONSUMPTION" | "RECEIPT" | "TRANSFER" | "ADJUSTMENT";

export interface AnalyticalDatasetManifest {
  readonly datasetId: "g1-vertical-v1";
  readonly schemaVersion: "1.0.0";
  readonly datasetVersion: string;
  readonly deterministicSeed: number;
  readonly generatedAt: string;
  readonly asOf: string;
  readonly sourceVersions: Readonly<Record<string, string>>;
  readonly expectedCounts: {
    readonly specifications: 12;
    readonly positions: 240;
    readonly assemblyPositions: 24;
    readonly componentPositions: 216;
    readonly mappedPositions: 228;
    readonly intentionalUnmappedPositions: 12;
    readonly warehouses: 4;
    readonly stockRows: 912;
    readonly movementRows: 11_856;
    readonly bomLinks: 144;
    readonly shortages: 48;
    readonly positiveAnalogueCases: 36;
    readonly noCandidateCases: 12;
    readonly responsibilityResolved: 228;
    readonly scenarioRuns: 48;
    readonly expertTasks: 24;
    readonly outcomeOracles: 24;
  };
  readonly checksum: string;
  readonly isSyntheticDemo: true;
}

export interface AnalyticalPositionLink {
  readonly positionId: string;
  readonly specificationId: string;
  readonly catalogItemCode: string | null;
  readonly sapMaterialCode: string | null;
  readonly itemKind: "COMPONENT" | "ASSEMBLY";
  readonly unit: string;
  readonly requiredQuantity: number;
  readonly intentionalNegative: boolean;
}

export interface AnalyticalStockSnapshot {
  readonly id: string;
  readonly materialCode: string;
  readonly warehouseId: string;
  readonly onHandQuantity: number;
  readonly reservedQuantity: number;
  readonly quarantinedQuantity: number;
  readonly unit: string;
  readonly snapshotAt: string;
}

export interface AnalyticalMovement {
  readonly id: string;
  readonly materialCode: string;
  readonly warehouseId: string;
  readonly type: AnalyticalMovementType;
  readonly quantity: number;
  readonly unit: string;
  readonly occurredAt: string;
  readonly sourceVersion: string;
}

export interface AnalyticalInboundSupply {
  readonly id: string;
  readonly materialCode: string;
  readonly warehouseId: string;
  readonly confirmedQuantity: number;
  readonly expectedAt: string;
  readonly leadTimeDays: number;
  readonly sourceVersion: string;
}

export interface AnalyticalShortageOracle {
  readonly positionId: string;
  readonly shortageQuantity: number;
  readonly expectedAnalogueOutcome: "CANDIDATE_AVAILABLE" | "NO_CANDIDATE";
  readonly expectedCandidateCodes: readonly string[];
  readonly ruleVersion: string;
}

export interface AnalyticalResponsibilityOracle {
  readonly positionId: string;
  readonly responsibility: "CUSTOMER" | "CONTRACTOR" | "UNKNOWN";
  readonly documentId: string | null;
  readonly documentVersion: string | null;
  readonly clauseId: string | null;
}

export interface AnalyticalProcessRun {
  readonly id: string;
  readonly specificationId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly outcome: "COMPLETED";
}

export interface AnalyticalExpertTask {
  readonly id: string;
  readonly runId: string;
  readonly positionId: string;
  readonly status: "APPROVED" | "REJECTED";
  readonly decidedAt: string;
}

export interface AnalyticalOutcomeOracle {
  readonly id: string;
  readonly positionId: string;
  readonly originAt: string;
  readonly observedAt: string;
  readonly predictedShortageQuantity: number;
  readonly actualShortageQuantity: number;
  readonly causeCode: "DEMAND_SPIKE" | "SUPPLY_DELAY" | "RESERVATION_GROWTH";
}

export interface AnalyticalScenarioDataset {
  readonly manifest: AnalyticalDatasetManifest;
  readonly positions: readonly AnalyticalPositionLink[];
  readonly stockSnapshots: readonly AnalyticalStockSnapshot[];
  readonly movements: readonly AnalyticalMovement[];
  readonly inboundSupplies: readonly AnalyticalInboundSupply[];
  readonly bomLinks: readonly {
    readonly assemblyCode: string;
    readonly componentCode: string;
    readonly quantity: number;
    readonly unit: string;
  }[];
  readonly shortages: readonly AnalyticalShortageOracle[];
  readonly responsibilities: readonly AnalyticalResponsibilityOracle[];
  readonly runs: readonly AnalyticalProcessRun[];
  readonly expertTasks: readonly AnalyticalExpertTask[];
  readonly outcomes: readonly AnalyticalOutcomeOracle[];
}

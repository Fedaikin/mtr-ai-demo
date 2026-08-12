export const DEMO_USER_ID = "demo-user-001" as const;
export const DEMO_USER_DISPLAY_NAME = "Демо-пользователь 1" as const;

export type UserRole = "USER" | "ADMIN";

export interface DemoUser {
  id: string;
  displayName: string;
  roles: UserRole[];
  locale: "ru-RU";
}

export type EquipmentType =
  | "PIPE"
  | "ELBOW"
  | "FLANGE"
  | "GATE_VALVE"
  | "VALVE"
  | "GASKET"
  | "FASTENER"
  | "CABLE"
  | "CABLE_TRAY"
  | "PUMP"
  | "ELECTRIC_MOTOR"
  | "PRESSURE_GAUGE"
  | "FITTING"
  | "REDUCER"
  | string;

export type Dimensions = Record<string, number | string | boolean | null>;

export interface Specification {
  id: string;
  userId: string;
  projectCode: string;
  name: string;
  latestVersionId: string;
  latestVersionNumber: number;
  positionCount: number;
}

export interface SpecificationVersion {
  id: string;
  specificationId: string;
  userId: string;
  versionNumber: number;
  isCurrent: boolean;
  status: "ACTIVE" | "SUPERSEDED";
  effectiveAt: string;
  positionCount: number;
}

export interface Position {
  id: string;
  userId: string;
  internalCode: string;
  nameRu: string;
  nameEn?: string;
  synonyms: string[];
  equipmentType: EquipmentType;
  manufacturer?: string;
  standard?: string;
  materialGrade?: string;
  dimensions: Dimensions;
  requiredQuantity: number;
  unit: string;
  specificationId: string;
  specificationName?: string;
  versionId: string;
  versionNumber: number;
  isCurrentVersion: boolean;
  classification: Record<string, string>;
  access: Record<string, unknown>;
  fixtureTags?: string[];
}

export interface SapMaterial {
  id: string;
  userId: string;
  materialCode: string;
  nameRu: string;
  nameEn?: string;
  synonyms: string[];
  legacyCode?: string;
  equipmentType: EquipmentType;
  manufacturer?: string;
  standard?: string;
  materialGrade?: string;
  dimensions: Dimensions;
  tolerances?: Dimensions;
  plant: string;
  storageLocation: string;
  batch?: string;
  availableQuantity: number;
  unit: string;
  snapshotAt: string;
  cardUrl: string;
  fixtureTags?: string[];
  sourcePositionId?: string;
}

export type IntegrationSystem = "APPIUS" | "SAP" | "RAG" | "LLM";
export type IntegrationStatus =
  | "AVAILABLE"
  | "UNAVAILABLE"
  | "SLOW"
  | "ACCESS_DENIED"
  | "STALE_VERSION"
  | "STALE"
  | "RATE_LIMITED"
  | "MALFORMED_RESPONSE";

export interface IntegrationState {
  system: IntegrationSystem;
  state: IntegrationStatus;
  delayMs: number;
  snapshotAt?: string;
  lastSynchronizedAt?: string;
  safeMessage?: string;
}

export interface RuleCitation {
  documentId: string;
  version: string;
  clauseId: string;
  title: string;
  isSyntheticDemo: true;
}

export interface RuleRetrievalEvidence {
  chunkId: string;
  language: string;
  score: number;
  lexicalScore: number;
  semanticScore: number;
  metadataScore: number;
  matchedAttributes: string[];
}

export interface ResponsibilityRule extends RuleCitation {
  equipmentTypes: EquipmentType[];
  responsibility: "CUSTOMER" | "CONTRACTOR";
  conditions?: Record<string, unknown>;
  text: string;
  retrievalEvidence?: RuleRetrievalEvidence;
}

export interface AnalogueRule extends RuleCitation {
  equipmentTypes: EquipmentType[];
  allowedStandardPairs?: Array<[string, string]>;
  allowedMaterialPairs?: Array<[string, string]>;
  dimensionTolerances?: Record<string, number>;
  text: string;
  retrievalEvidence?: RuleRetrievalEvidence;
}

export type MatchCategory = "EXACT" | "LIKELY" | "REVIEW" | "NO_MATCH";

export interface MatchExplanation {
  score: number;
  category: MatchCategory;
  material: SapMaterial | null;
  matched: string[];
  differences: string[];
  requiresHumanReview: boolean;
}

export type AnalogueVerdict = "SUITABLE" | "REVIEW" | "NOT_RECOMMENDED";

export interface AnalogueAllocation {
  material: SapMaterial;
  allocatedQuantity: number;
  remainingAfterReservation: number;
  deviations: Array<{
    characteristic: string;
    required: string;
    available: string;
    deviation: string;
  }>;
  verdict: AnalogueVerdict;
  citation: RuleCitation;
}

export interface AnalogueCoveragePlan {
  coveredQuantity: number;
  allocations: AnalogueAllocation[];
  complete: boolean;
}

export interface AnalogueCoverage {
  requiredQuantity: number;
  coveredQuantity: number;
  directCoveredQuantity?: number;
  unit: string;
  allocations: AnalogueAllocation[];
  complete: boolean;
  /**
   * The explicit plan fields are additive. The top-level coverage fields above
   * remain aliases of the primary plan so persisted legacy reports and tool
   * consumers continue to work.
   */
  primaryPlan?: AnalogueCoveragePlan;
  alternativePlans?: AnalogueCoveragePlan[];
}

export interface AnalogueSearchDecision {
  directCoveredQuantity: number;
  shortageQuantity: number;
  outcome: "ALLOCATED" | "NO_APPLICABLE_RULE" | "NO_ELIGIBLE_CANDIDATE";
  ruleCount: number;
}

export interface PositionAnalysisResult {
  position: Position;
  responsibility: "CUSTOMER" | "CONTRACTOR";
  responsibilityConfidence: number;
  responsibilityExplanation?: string;
  responsibilityCitation: RuleCitation;
  match: MatchExplanation;
  analogueSearch?: AnalogueSearchDecision;
  analogueCoverage?: AnalogueCoverage;
  status: "FOUND" | "NOT_FOUND" | "ANALOGUES" | "INSUFFICIENT";
  requiresHumanReview: boolean;
  analysisVersion?: number;
  manualResponsibilityOverrides?: Array<{
    before: "CUSTOMER" | "CONTRACTOR";
    after: "CUSTOMER" | "CONTRACTOR";
    reason: string;
    actor: string;
    occurredAt: string;
  }>;
}

export const RUN_STATUSES = [
  "QUEUED",
  "LOADING_APPIUS",
  "SYNCING_SAP",
  "CLASSIFYING_RESPONSIBILITY",
  "MATCHING_STOCK",
  "FINDING_ANALOGUES",
  "GENERATING_REPORT",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type ScenarioRunStatus = (typeof RUN_STATUSES)[number];

export interface ScenarioDefinition {
  id: string;
  userId: string;
  name: string;
  description: string;
  enabled: boolean;
  kind: "FULL" | "STOCK_ONLY" | "SAP_FAILURE" | "APPIUS_NEW_VERSION" | "COMPOSITE_ANALOGUE";
}

export interface ScenarioRunStep {
  id: string;
  runId: string;
  status: ScenarioRunStatus;
  label: string;
  outcome: "STARTED" | "COMPLETED" | "FAILED" | "CANCELLED";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  details?: Record<string, unknown>;
}

export interface ScenarioRun {
  id: string;
  userId: string;
  scenarioId: string;
  specificationId: string;
  status: ScenarioRunStatus;
  currentStep: string;
  progress: number;
  mode: "NORMAL" | "DRY_RUN";
  seed: string;
  version: number;
  retryOfRunId?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  inputSnapshot: Record<string, unknown>;
  outputSnapshot: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  steps: ScenarioRunStep[];
}

export interface ReportSummary {
  total: number;
  exact: number;
  found: number;
  likely: number;
  review: number;
  noMatch: number;
  analogues: number;
  insufficient: number;
  procurement: number;
  customerResponsibility: number;
  contractorResponsibility: number;
}

export interface GroundedCitation {
  sourceSystem: "APPIUS" | "SAP" | "CATALOG" | "NORMATIVE" | "SCENARIO" | "REPORT";
  entityId: string;
  versionOrSnapshot: string;
  clauseId: string | null;
}

export interface GroundedAgentOutput {
  answer: string;
  facts: string[];
  recommendations: string[];
  citations: GroundedCitation[];
  confidence: number;
  requiresHumanReview: boolean;
  toolCalls: Array<{ tool: string; outcome: "OK" | "ERROR"; durationMs: number }>;
}

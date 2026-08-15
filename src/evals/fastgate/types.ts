export type FastGateCaseId = `FG-${string}`;
export type FastGateCaseStatus = "PASS" | "PARTIAL" | "FAIL" | "NOT_RUN" | "BLOCKED_BY_ENVIRONMENT" | "INVALID";
export type AssessmentConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface FastGateAssertionDefinition {
  readonly id: string;
  readonly points: number;
  readonly mandatory: boolean;
}

export interface FastGateCaseDefinition {
  readonly id: FastGateCaseId;
  readonly title: string;
  readonly weight: number;
  readonly expectedAgentMessages: number;
  readonly assertions: readonly FastGateAssertionDefinition[];
}

export interface FastGateManifest {
  readonly schemaVersion: "mtr-agent-fastgate-manifest-v1";
  readonly manifestVersion: string;
  readonly expectedAgentMessages: number;
  readonly localRuntimeLimitMs: number;
  readonly previewRuntimeLimitMs: number;
  readonly requestTimeoutMs: number;
  readonly cases: readonly FastGateCaseDefinition[];
  readonly phrasingBanks: Readonly<Record<string, readonly string[]>>;
}

export interface FastGateAssertionResult {
  readonly id: string;
  readonly passed: boolean;
  readonly evidence: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
  readonly safeSelectedIds?: readonly string[];
  readonly citationIds?: readonly string[];
  readonly snapshotIds?: readonly string[];
  readonly correlationId?: string | null;
}

export interface FastGateCaseResult {
  readonly id: FastGateCaseId;
  readonly status: FastGateCaseStatus;
  readonly points: number;
  readonly weight: number;
  readonly durationMs: number;
  readonly assertions: readonly FastGateAssertionResult[];
  readonly evidence: readonly string[];
  readonly defect: string | null;
  readonly sourceBindingVerified: boolean;
}

export interface FastGateScoreInput {
  readonly manifest: FastGateManifest;
  readonly cases: readonly FastGateCaseResult[];
  readonly oracleAvailable: boolean;
  readonly sourceBindingVerified: boolean;
  readonly assessmentConfidence: AssessmentConfidence;
  readonly criticalBlockers: readonly string[];
  readonly fabricatedBusinessFact?: boolean;
  readonly sensitiveDisclosure?: boolean;
  readonly rbacLeak?: boolean;
  readonly privilegedActionExecuted?: boolean;
  readonly productionTouched?: boolean;
  readonly invalidEnvironment?: boolean;
}

export interface FastGateScore {
  readonly rawScore: number;
  readonly cappedScore: number;
  readonly verifiedCapabilityPoints: number;
  readonly verifiedCapabilityMax: number;
  readonly verifiedCapabilityPercent: number;
  readonly acceptanceReadinessScore: number;
  readonly acceptanceLevel: string;
  readonly evaluationCoveragePercent: number;
  readonly level: string;
  readonly assessmentConfidence: AssessmentConfidence;
  readonly appliedCaps: readonly Readonly<{ reason: string; cap: number }>[];
  readonly exitCode: 0 | 1 | 2 | 3;
  readonly verdict: "READY FOR FULL ACCEPTANCE" | "NOT READY FOR FULL ACCEPTANCE" | "INVALID TEST RUN" | "CRITICAL FAIL";
}

export interface FastGateAssertionEvidence {
  readonly runId: string;
  readonly seed: string;
  readonly deploymentSha: string;
  readonly datasetFingerprint: string;
  readonly manifestVersion: string;
  readonly manifestSha256: string;
  readonly evaluatorSha256: string;
  readonly oracleSha256: string;
  readonly runIdentitySha256: string;
  readonly selectionCommitmentSha256: string;
  readonly caseId: FastGateCaseId;
  readonly assertionId: string;
  readonly promptTemplateId: string | null;
  readonly safeSelectedIds: readonly string[];
  readonly expected: unknown;
  readonly actual: unknown;
  readonly comparison: string;
  readonly citationIds: readonly string[];
  readonly snapshotIds: readonly string[];
  readonly correlationId: string | null;
  readonly sourceBindingHash: string | null;
  readonly passed: boolean;
}

export interface FastGateOracleSnapshot {
  readonly schemaVersion: "mtr-agent-fastgate-oracle-v1";
  readonly createdAt: string;
  readonly environment: "LOCAL_TEST" | "PREVIEW";
  readonly deploymentSha: string;
  readonly datasetVersion: string;
  readonly datasetChecksum: string;
  readonly promptVersion: string;
  readonly activeProjectIdsBySubject: Readonly<Record<string, readonly string[]>>;
  readonly accessibleProjectIdsBySubject: Readonly<Record<string, readonly string[]>>;
  readonly projects: readonly Readonly<{ id: string; code: string; name: string; status: string; accessProjectId: string; needDate: string }>[];
  readonly specifications: readonly Readonly<{ id: string; projectId: string; code: string; name: string; purpose: string }>[];
  readonly materials: readonly FastGateOracleMaterial[];
  readonly shortages: readonly Readonly<{
    projectId: string;
    materialCode: string;
    required: number;
    available: number;
    shortage: number;
    unit: string;
    riskLabel: "Дефицит" | "Исчерпание" | "Контроль";
  }>[];
  readonly intakes: readonly Readonly<{ id: string; projectId: string; status: string; currentStep: string; receivedAt: string; slaDeadline: string }>[];
  readonly deadlines: readonly Readonly<{ projectId: string; dueAt: string; status: string }>[];
  readonly analoguePairs: readonly Readonly<{
    sourceCode: string;
    candidateCode: string;
    familyId: string;
    expectedCompatibilityPercent: number | null;
    expectedQuantityCoveragePercent: number;
    expectedVerdictLabel: string;
    expectedDeviations: readonly string[];
  }>[];
  readonly roleProfiles: Readonly<Record<string, Readonly<{ login: string; accountType: string; permissions: readonly string[]; warehouseIds: readonly string[] }>>>;
  readonly lastCompletedRun: Readonly<{
    id: string;
    resultCount: number;
    responsibilityMismatchCount: number;
    responsibilityCitationCount: number;
    customerResponsibility: number;
    contractorResponsibility: number;
    reviewRequiredCount: number;
    insufficientDataCount: number;
    decisions: readonly Readonly<{
      positionId: string;
      state: "RESOLVED" | "REVIEW_REQUIRED" | "INSUFFICIENT_DATA";
      responsibility: "CUSTOMER" | "CONTRACTOR" | null;
      citationDocumentId: string | null;
      citationClauseId: string | null;
    }>[];
  }> | null;
  readonly targetStateChecksum: string;
  readonly dataChecksum: string;
  readonly databaseState: import("@/evals/fastgate/official/database-state").FastGateDatabaseStateSnapshot;
  readonly actionSafetyState: readonly import("@/evals/fastgate/official/database-state").FastGateActionSafetyState[];
  readonly reviewSafetyState: readonly import("@/evals/fastgate/official/database-state").FastGateReviewSafetyState[];
}

export interface FastGateOracleMaterial {
  readonly code: string;
  readonly name: string;
  readonly sourceKind: string;
  readonly familyId: string | null;
  readonly equipmentType: string;
  readonly unit: string;
  readonly snapshotId: string;
  readonly snapshotAt: string;
  readonly balances: readonly Readonly<{ warehouseId: string; onHand: number; reserved: number; quarantined: number; available: number }>[];
  readonly reliabilityEvidenceCount: number;
  readonly reliability: Readonly<{
    operatingHours: number;
    mtbfHours: number;
    failureCount: number;
    qualityRejectionCount: number;
    supplyRiskPercent: number;
    observedAt: string;
    sourceEvidenceIds: readonly string[];
  }>;
  readonly itemKind: "COMPONENT" | "ASSEMBLY";
  readonly standard: string | null;
  readonly materialGrade: string | null;
  readonly manufacturer: string | null;
  readonly compatibilityStatus: "VALID_MEMBER" | "INCOMPATIBLE_DECOY" | "NOT_APPLICABLE";
  readonly characteristics: Readonly<Record<string, string | number | boolean | null>>;
}

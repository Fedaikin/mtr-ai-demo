export interface OfficialFastGateRunEvidence {
  readonly runId: string;
  readonly seed: string;
  readonly deploymentSha: string;
  readonly sourceTreeSha256: string;
  readonly lockfileSha256: string;
  readonly manifestSha256: string;
  readonly evaluatorSha256: string;
  readonly oracleSha256: string;
  readonly applicationImageDigest: string;
  readonly witnessImageDigest: string;
  readonly proxyImageDigest: string;
  readonly supervisorImageDigest: string;
  readonly verifierImageDigest: string;
  readonly assessmentConfidence: "HIGH" | "MEDIUM" | "LOW";
  readonly agentMessageCount: number;
  readonly passedCaseCount: number;
  readonly rawScore: number;
  readonly verifiedCapabilityPercent: number;
  readonly acceptanceReadinessScore: number;
  readonly evaluationCoveragePercent: number;
  readonly diagnosticSignatureVerified: boolean;
  readonly independentConnectorWitnessVerified: boolean;
  readonly signedHttpTranscriptVerified: boolean;
  readonly runtimeAttestationVerified: boolean;
  readonly counterfactualWitnessVerified: boolean;
  readonly sourceBindingVerified: boolean;
  readonly cleanupVerified: boolean;
  readonly databaseMutationVerified: boolean;
  readonly appliedCaps: readonly unknown[];
  readonly criticalBlockers: readonly string[];
}

export interface OfficialFastGateSecurityCheck {
  readonly id: string;
  readonly expectedStatuses: readonly number[];
  readonly actualStatus: number | null;
  readonly responseSha256: string;
  readonly responseBytes: number;
  readonly setCookiePresent: boolean;
  readonly leak: boolean;
  readonly passed: boolean;
}

export interface OfficialFastGateSecuritySummary {
  readonly schemaVersion: "mtr-fastgate-security-gate-v2";
  readonly requestedSessions: number;
  readonly authenticatedSessions: number;
  readonly uniqueAuthenticatedSessions: number;
  readonly passedSessions: number;
  readonly leaks: number;
  readonly violations: number;
  readonly rbacIsolationVerified: boolean;
  readonly anonymousDenied: boolean;
  readonly serviceAccountInteractiveDenied: boolean;
  readonly crossProjectDenied: boolean;
  readonly adminBoundaryVerified: boolean;
  readonly activeSessionContinuityVerified: boolean;
  readonly activeSessionEvidenceSha256: string;
  readonly checks: readonly OfficialFastGateSecurityCheck[];
}

export interface OfficialFastGateAggregate {
  readonly schemaVersion: "mtr-agent-fastgate-official-aggregate-v1";
  readonly generatedAt: string;
  readonly runs: readonly OfficialFastGateRunEvidence[];
  readonly security: OfficialFastGateSecuritySummary;
  readonly load: Readonly<{
    requestedSessions: number;
    authenticatedSessions: number;
    uniqueAuthenticatedSessions: number;
    completedSessions: number;
    errors: number;
    p95Ms: number;
    serviceP95Ms: number;
    authenticationSetupP95Ms: number;
    queueWaitP95Ms: number;
    maxInFlightRequests: number;
    limitMs: number;
  }>;
  readonly securityRuns: readonly OfficialFastGateSecuritySummary[];
  readonly loadRuns: readonly Readonly<{
    requestedSessions: number;
    authenticatedSessions: number;
    uniqueAuthenticatedSessions: number;
    completedSessions: number;
    errors: number;
    p95Ms: number;
    serviceP95Ms: number;
    authenticationSetupP95Ms: number;
    queueWaitP95Ms: number;
    maxInFlightRequests: number;
    limitMs: number;
  }>[];
  readonly artifactFiles: readonly Readonly<{ path: string; bytes: number; sha256: string }>[];
  readonly independentReview: Readonly<{
    valid: boolean;
    reviewerRole: string;
    artifactSha256: string;
    inputCommitmentSha256: string;
    finalSha: string;
  }>;
}

export interface OfficialFastGateVerification {
  readonly valid: boolean;
  readonly verdict: "PASS" | "FAIL";
  readonly minimumAcceptanceReadiness: number;
  readonly medianAcceptanceReadiness: number;
  readonly errors: readonly string[];
}

const SHARED_FIELDS: readonly (keyof OfficialFastGateRunEvidence)[] = [
  "deploymentSha",
  "sourceTreeSha256",
  "lockfileSha256",
  "manifestSha256",
  "evaluatorSha256",
  "oracleSha256",
  "applicationImageDigest",
  "witnessImageDigest",
  "proxyImageDigest",
  "supervisorImageDigest",
  "verifierImageDigest",
];

export function verifyOfficialFastGateAggregate(aggregate: OfficialFastGateAggregate): OfficialFastGateVerification {
  const errors: string[] = [];
  if (aggregate.schemaVersion !== "mtr-agent-fastgate-official-aggregate-v1") errors.push("INVALID_AGGREGATE_SCHEMA");
  if (aggregate.runs.length !== 3) errors.push("EXACT_THREE_RUNS_REQUIRED");
  if (aggregate.securityRuns.length !== 3) errors.push("EXACT_THREE_SECURITY_GATES_REQUIRED");
  if (aggregate.loadRuns.length !== 3) errors.push("EXACT_THREE_LOAD_GATES_REQUIRED");
  const seeds = new Set(aggregate.runs.map((run) => run.seed));
  if (seeds.size !== aggregate.runs.length || [...seeds].some((seed) => !/^[a-f0-9]{64}$/u.test(seed))) errors.push("UNIQUE_CRYPTOGRAPHIC_SEEDS_REQUIRED");
  const runIds = new Set(aggregate.runs.map((run) => run.runId));
  if (runIds.size !== aggregate.runs.length) errors.push("UNIQUE_RUN_IDS_REQUIRED");

  const first = aggregate.runs[0];
  if (first) {
    for (const field of SHARED_FIELDS) {
      if (aggregate.runs.some((run) => run[field] !== first[field])) errors.push(`RUN_IDENTITY_MISMATCH:${field}`);
    }
  }

  for (const run of aggregate.runs) {
    if (run.assessmentConfidence !== "HIGH") errors.push(`CONFIDENCE_NOT_HIGH:${run.runId}`);
    if (run.agentMessageCount !== 23) errors.push(`MESSAGE_COUNT_MISMATCH:${run.runId}`);
    if (run.passedCaseCount !== 12) errors.push(`CASE_COUNT_MISMATCH:${run.runId}`);
    if (run.acceptanceReadinessScore < 93) errors.push(`READINESS_BELOW_93:${run.runId}`);
    if (run.rawScore < run.acceptanceReadinessScore) errors.push(`INVALID_SCORE_RELATION:${run.runId}`);
    if (run.verifiedCapabilityPercent < 93 || run.evaluationCoveragePercent !== 100) errors.push(`INSUFFICIENT_VERIFIED_COVERAGE:${run.runId}`);
    if (!run.diagnosticSignatureVerified) errors.push(`DIAGNOSTIC_SIGNATURE_NOT_VERIFIED:${run.runId}`);
    if (!run.signedHttpTranscriptVerified) errors.push(`HTTP_TRANSCRIPT_NOT_VERIFIED:${run.runId}`);
    if (!run.independentConnectorWitnessVerified) errors.push(`CONNECTOR_WITNESS_NOT_VERIFIED:${run.runId}`);
    if (!run.runtimeAttestationVerified) errors.push(`RUNTIME_ATTESTATION_NOT_VERIFIED:${run.runId}`);
    if (!run.counterfactualWitnessVerified) errors.push(`OVERLAY_NOT_VERIFIED:${run.runId}`);
    if (!run.sourceBindingVerified) errors.push(`FACTUAL_SOURCE_BINDING_NOT_VERIFIED:${run.runId}`);
    if (!run.cleanupVerified) errors.push(`CLEANUP_NOT_VERIFIED:${run.runId}`);
    if (!run.databaseMutationVerified) errors.push(`DATABASE_MUTATION_BOUNDARY_NOT_VERIFIED:${run.runId}`);
    if (run.appliedCaps.length > 0) errors.push(`SCORE_CAP_PRESENT:${run.runId}`);
    if (run.criticalBlockers.length > 0) errors.push(`CRITICAL_BLOCKER_PRESENT:${run.runId}`);
  }

  const scores = aggregate.runs.map((run) => run.acceptanceReadinessScore).sort((a, b) => a - b);
  const minimumAcceptanceReadiness = scores[0] ?? 0;
  const medianAcceptanceReadiness = scores.length === 3 ? scores[1]! : 0;
  if (medianAcceptanceReadiness < 95) errors.push("MEDIAN_READINESS_BELOW_95");
  if (!securitySummaryValid(aggregate.security, false)) {
    errors.push("SECURITY_10_SESSION_GATE_FAILED");
  }
  aggregate.securityRuns.forEach((security, index) => {
    if (!securitySummaryValid(security, true)) {
      errors.push(`SECURITY_RUN_FAILED:${index + 1}`);
    }
  });
  if (aggregate.load.requestedSessions !== 50 || aggregate.load.authenticatedSessions !== 50
    || aggregate.load.uniqueAuthenticatedSessions !== 50 || aggregate.load.completedSessions !== 50
    || aggregate.load.errors !== 0 || aggregate.load.maxInFlightRequests > 10
    || aggregate.load.p95Ms > aggregate.load.limitMs) {
    errors.push("LOAD_50_SESSION_GATE_FAILED");
  }
  aggregate.loadRuns.forEach((load, index) => {
    if (load.requestedSessions !== 50 || load.authenticatedSessions !== 50 || load.uniqueAuthenticatedSessions !== 50
      || load.completedSessions !== 50 || load.errors !== 0 || load.maxInFlightRequests > 10
      || load.p95Ms > load.limitMs || load.p95Ms > 5_000) {
      errors.push(`LOAD_RUN_FAILED:${index + 1}`);
    }
  });
  const artifactPaths = new Set(aggregate.artifactFiles.map((file) => file.path));
  if (!aggregate.artifactFiles.length || artifactPaths.size !== aggregate.artifactFiles.length || aggregate.artifactFiles.some((file) => !isSafeArtifactPath(file.path)
    || !Number.isInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/u.test(file.sha256))) {
    errors.push("INVALID_ARTIFACT_COMMITMENTS");
  }
  if (!aggregate.independentReview.valid || aggregate.independentReview.reviewerRole !== "READ_ONLY_REVIEWER"
    || !/^[a-f0-9]{64}$/u.test(aggregate.independentReview.artifactSha256)
    || !/^[a-f0-9]{64}$/u.test(aggregate.independentReview.inputCommitmentSha256)
    || aggregate.independentReview.finalSha !== first?.deploymentSha) {
    errors.push("INDEPENDENT_REVIEW_INVALID");
  }
  return Object.freeze({
    valid: errors.length === 0,
    verdict: errors.length === 0 ? "PASS" : "FAIL",
    minimumAcceptanceReadiness,
    medianAcceptanceReadiness,
    errors: Object.freeze(errors),
  });
}

function securitySummaryValid(security: OfficialFastGateSecuritySummary, requireChecks: boolean): boolean {
  const ids = new Set(security.checks.map((check) => check.id));
  return security.schemaVersion === "mtr-fastgate-security-gate-v2"
    && security.requestedSessions === 10 && security.passedSessions === 10
    && security.authenticatedSessions === 10 && security.uniqueAuthenticatedSessions === 10
    && security.leaks === 0 && security.violations === 0
    && security.rbacIsolationVerified && security.anonymousDenied
    && security.serviceAccountInteractiveDenied && security.crossProjectDenied
    && security.adminBoundaryVerified
    && security.activeSessionContinuityVerified
    && /^[a-f0-9]{64}$/u.test(security.activeSessionEvidenceSha256)
    && (!requireChecks || (security.checks.length === 10 && ids.size === 10
      && security.checks.every((check) => check.passed && !check.leak
        && /^[a-f0-9]{64}$/u.test(check.responseSha256)
        && Number.isInteger(check.responseBytes) && check.responseBytes >= 0)));
}

function isSafeArtifactPath(path: string): boolean {
  return Boolean(path) && !path.startsWith("/") && !path.split("/").includes("..") && !path.includes("\\");
}

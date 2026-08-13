export const AGENT_EVIDENCE_AVAILABILITY = ["COMPLETE", "PARTIAL", "UNAVAILABLE"] as const;

export type AgentEvidenceAvailability = (typeof AGENT_EVIDENCE_AVAILABILITY)[number];

export const AGENT_EVIDENCE_SOURCE_KINDS = [
  "MATERIAL_MOVEMENT",
  "PROCESS_EVENT",
  "TECHNICAL_SAMPLE",
  "DEFINITION",
  "STOCK_SNAPSHOT",
  "SPECIFICATION_VERSION",
  "TASK_RECORD",
  "RISK_RECORD",
] as const;

export type AgentEvidenceSourceKind = (typeof AGENT_EVIDENCE_SOURCE_KINDS)[number];

export const AGENT_EVIDENCE_SOURCE_SYSTEMS = [
  "SAP",
  "APPIUS",
  "RAG",
  "LLM",
  "PROCESS_ENGINE",
  "TELEMETRY",
  "METRIC_REGISTRY",
  "TASK_STORE",
  "RISK_ENGINE",
] as const;

export type AgentEvidenceSourceSystem = (typeof AGENT_EVIDENCE_SOURCE_SYSTEMS)[number];

export interface AgentCitation {
  readonly sourceKind: AgentEvidenceSourceKind;
  readonly sourceSystem: AgentEvidenceSourceSystem;
  readonly entityId: string;
  /** Snapshot/version of the cited source item, never the metric definition version. */
  readonly sourceSnapshot: string;
  readonly observedAt: string;
  readonly clauseId?: string | null;
}

export interface AgentMissingData {
  readonly code: string;
  readonly message: string;
}

export interface AgentEvidenceCoverage {
  readonly requestedScope: readonly string[];
  readonly checkedScope: readonly string[];
  readonly complete: boolean;
}

export interface AgentEvidence {
  readonly availability: AgentEvidenceAvailability;
  readonly confidence: number;
  readonly coverage: AgentEvidenceCoverage;
  readonly citations: readonly AgentCitation[];
  readonly missingData: readonly AgentMissingData[];
}

export type NegativeEvidenceConclusion = "NOT_EMPTY" | "PROVEN_EMPTY" | "UNPROVEN_EMPTY";

export interface NegativeEvidenceAssessment {
  readonly conclusion: NegativeEvidenceConclusion;
  readonly confidence: number;
  readonly requiresHumanReview: boolean;
}

/**
 * Central honesty gate for positive and negative command results.
 * An empty list is evidence only when the complete requested scope was checked
 * and at least one concrete source snapshot supports that check.
 */
export function assessNegativeEvidence(
  resultCount: number,
  evidence: AgentEvidence,
  requiredScope: readonly string[] = evidence.coverage.requestedScope,
): NegativeEvidenceAssessment {
  const hasCitation = evidence.citations.some(isSubstantialCitation);
  const fullCoverage = coversRequiredScope(evidence.coverage, requiredScope);
  const completeEvidence =
    evidence.availability === "COMPLETE" &&
    fullCoverage &&
    hasCitation &&
    evidence.missingData.length === 0;

  if (resultCount > 0) {
    return {
      conclusion: "NOT_EMPTY",
      confidence: hasCitation ? normalizedConfidence(evidence.confidence) : 0,
      requiresHumanReview: !completeEvidence,
    };
  }

  if (completeEvidence) {
    return {
      conclusion: "PROVEN_EMPTY",
      confidence: normalizedConfidence(evidence.confidence),
      requiresHumanReview: false,
    };
  }

  return {
    conclusion: "UNPROVEN_EMPTY",
    confidence: 0,
    requiresHumanReview: true,
  };
}

function coversRequiredScope(
  coverage: AgentEvidenceCoverage,
  requiredScope: readonly string[],
): boolean {
  if (!coverage.complete || requiredScope.length === 0) return false;
  const requested = new Set(coverage.requestedScope);
  const checked = new Set(coverage.checkedScope);
  return requiredScope.every((scopeId) => requested.has(scopeId) && checked.has(scopeId));
}

function isSubstantialCitation(citation: AgentCitation): boolean {
  return Boolean(
    citation.entityId.trim() &&
      citation.sourceSnapshot.trim() &&
      citation.observedAt.trim() &&
      Number.isFinite(Date.parse(citation.observedAt)),
  );
}

function normalizedConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

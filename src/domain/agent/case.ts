import type { AgentEvidenceSourceSystem } from "@/domain/agent/evidence";

export const AGENT_CASE_STATUSES = [
  "DRAFT",
  "GATHERING_DATA",
  "ANALYZED",
  "NEEDS_REVIEW",
  "READY",
  "BLOCKED",
  "CLOSED",
] as const;

export type AgentCaseStatus = (typeof AGENT_CASE_STATUSES)[number];
export type AgentEvidenceFreshness = "FRESH" | "AGING" | "STALE" | "UNKNOWN";

export interface AgentAnalysisHistoryCitation {
  readonly sourceSystem: "APPIUS" | "SAP" | "CATALOG" | "NORMATIVE" | "PROCESS_ENGINE";
  readonly entityId: string;
  readonly versionOrSnapshot: string;
  readonly observedAt: string;
  readonly clauseId: string | null;
}

export interface AgentAnalysisHistoryInput {
  readonly summary: string;
  readonly confidence: number;
  readonly requiresHumanReview: boolean;
  readonly generatedAt: string;
  readonly datasetVersion: string;
  readonly semanticRegistryVersion: string;
  readonly forecastModelVersion: string | null;
  readonly recommendation: string | null;
  readonly citations: readonly AgentAnalysisHistoryCitation[];
}

export interface AgentAnalysisHistorySnapshot
  extends Omit<AgentAnalysisHistoryInput, "citations"> {
  readonly schemaVersion: "mtr-agent-analysis-history-v1";
  readonly conclusionFingerprint: string;
  readonly previousCaseId: string | null;
  readonly changedConclusion: boolean | null;
  readonly sourceCount: number;
}

export interface AgentCaseContextSnapshot {
  readonly specificationId?: string;
  readonly positionId?: string;
  readonly runId?: string;
  readonly period?: Readonly<{ from: string; to: string }>;
  readonly analysisHistory?: AgentAnalysisHistorySnapshot;
}

export interface AgentCaseRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly ownerSubjectId: string;
  readonly threadId: string | null;
  readonly status: AgentCaseStatus;
  readonly title: string;
  readonly contextSnapshot: AgentCaseContextSnapshot;
  readonly authorizationVersion: number;
  readonly roleAssignmentSnapshot: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface AgentEvidenceFactRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly caseId: string;
  readonly kind: string;
  readonly summary: string;
  readonly sourceSystem: AgentEvidenceSourceSystem;
  readonly entityId: string;
  readonly versionOrSnapshot: string;
  readonly clauseId: string | null;
  readonly observedAt: string;
  readonly sourceSnapshotAt: string;
  readonly freshness: AgentEvidenceFreshness;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly accessAttributes: Readonly<Record<string, unknown>>;
  readonly fingerprint: string;
  readonly authorizationVersion: number;
  readonly roleAssignmentSnapshot: readonly string[];
  readonly createdBySubjectId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface PublicAgentEvidenceFact {
  readonly id: string;
  readonly kind: string;
  readonly summary: string;
  readonly sourceSystem: AgentEvidenceSourceSystem;
  readonly entityId: string;
  readonly versionOrSnapshot: string;
  readonly clauseId: string | null;
  readonly observedAt: string;
  readonly sourceSnapshotAt: string;
  readonly freshness: AgentEvidenceFreshness;
}

export interface PublicAgentCase extends Omit<
  AgentCaseRecord,
  "tenantId" | "roleAssignmentSnapshot" | "contextSnapshot"
> {
  readonly contextSnapshot: Omit<AgentCaseContextSnapshot, "analysisHistory"> & {
    readonly analysisHistory?: Omit<AgentAnalysisHistorySnapshot, "conclusionFingerprint">;
  };
  readonly evidence: readonly PublicAgentEvidenceFact[];
  readonly revokedEvidenceCount: number;
}

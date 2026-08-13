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

export interface AgentCaseContextSnapshot {
  readonly specificationId?: string;
  readonly positionId?: string;
  readonly runId?: string;
  readonly period?: Readonly<{ from: string; to: string }>;
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

export interface PublicAgentCase extends Omit<AgentCaseRecord, "tenantId" | "roleAssignmentSnapshot"> {
  readonly evidence: readonly PublicAgentEvidenceFact[];
  readonly revokedEvidenceCount: number;
}

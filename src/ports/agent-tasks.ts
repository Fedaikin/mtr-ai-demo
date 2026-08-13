import type { AgentExecutionContext } from "@/domain/agent/context";
import type {
  DigestKpiChange,
  DigestPeriod,
  DigestPositionChange,
  DigestSourceState,
  DigestSpecificationChange,
} from "@/domain/agent/digest";
import type { AgentEvidenceAvailability, AgentMissingData } from "@/domain/agent/evidence";

/**
 * Read model combines canonical human decisions with confirmed orchestrator
 * assignments. `projectId` is always resolved server-side from the owning scope.
 */
export interface AnalysisReviewDecisionTaskRecord {
  readonly id: string;
  readonly ownerSubjectId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly resultId: string;
  readonly positionId: string;
  readonly status: string;
  readonly doublecheckOutcome: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly decidedAt: string | null;
}

export interface AssignedAgentTaskRecord {
  readonly id: string;
  readonly ownerSubjectId: string;
  readonly projectId: string;
  readonly reviewDecisionId: string | null;
  readonly kind: string;
  readonly status: string;
  readonly priority: string;
  readonly title: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly allowedActions: readonly string[];
  readonly dueAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AnalysisReviewDecisionReadQuery {
  readonly ownerSubjectId: string;
  readonly projectId: string;
}

export interface AnalysisReviewDecisionSnapshot {
  readonly snapshotAt: string;
  readonly availability: AgentEvidenceAvailability;
  readonly complete: boolean;
  readonly items: readonly AnalysisReviewDecisionTaskRecord[];
  readonly assignedTasks?: readonly AssignedAgentTaskRecord[];
  readonly missingData: readonly AgentMissingData[];
}

export interface AnalysisReviewDecisionReadPort {
  list(
    context: AgentExecutionContext,
    query: AnalysisReviewDecisionReadQuery,
  ): Promise<AnalysisReviewDecisionSnapshot>;
}

export interface WeeklyDigestSourceReadQuery {
  readonly projectId: string;
  readonly subjectId: string;
  readonly period: DigestPeriod;
  readonly previousPeriod: DigestPeriod;
}

export interface WeeklyDigestSourceSnapshot {
  readonly snapshotAt: string;
  readonly sources: Readonly<{
    specifications: DigestSourceState;
    positions: DigestSourceState;
    kpi: DigestSourceState;
  }>;
  readonly specificationChanges: readonly DigestSpecificationChange[];
  readonly positionChanges: readonly DigestPositionChange[];
  readonly kpiChanges: readonly DigestKpiChange[];
}

export interface WeeklyDigestSourcePort {
  read(
    context: AgentExecutionContext,
    query: WeeklyDigestSourceReadQuery,
  ): Promise<WeeklyDigestSourceSnapshot>;
}

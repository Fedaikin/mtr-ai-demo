import type { AgentEvidenceAvailability, AgentMissingData } from "@/domain/agent/evidence";
import type {
  PersonalTaskAction,
  TaskReviewKind,
  TaskReviewPriority,
  TaskReviewStatus,
} from "@/domain/agent/task-review";

export type WeeklyDigestRoleView = "VIEWER" | "ANALYST" | "EXPERT" | "MANAGER";
export type DigestVisibility = "PUBLISHED" | "PROJECT" | "PERSONAL";

export interface DigestPeriod {
  readonly from: string;
  readonly to: string;
  readonly timezone: string;
}

export interface DigestSourceState {
  readonly availability: AgentEvidenceAvailability;
  readonly complete: boolean;
  readonly snapshotAt: string | null;
  readonly missingData: readonly AgentMissingData[];
}

export interface DigestSpecificationChange {
  readonly id: string;
  readonly projectId: string;
  readonly specificationId: string;
  readonly title: string;
  readonly changeType: "NEW" | "UPDATED";
  readonly version: string;
  readonly visibility: DigestVisibility;
  readonly affectedSubjectIds: readonly string[];
  readonly occurredAt: string;
}

export interface DigestPositionChange {
  readonly id: string;
  readonly projectId: string;
  readonly specificationId: string;
  readonly positionId: string;
  readonly kind: "SHORTAGE" | "EXPERT_REVIEW";
  readonly title: string;
  readonly affectedSubjectIds: readonly string[];
  readonly occurredAt: string;
}

export interface DigestKpiChange {
  readonly id: string;
  readonly projectId: string;
  readonly subjectId: string | null;
  readonly scope: "PERSONAL" | "EXPERT" | "PROJECT";
  readonly label: string;
  readonly currentValue: number;
  readonly previousValue: number | null;
  readonly unit: string;
  readonly occurredAt: string;
}

export interface PublicDigestSpecificationChange
  extends Omit<DigestSpecificationChange, "projectId" | "affectedSubjectIds"> {
  readonly href: string;
}

export interface PublicDigestPositionChange
  extends Omit<DigestPositionChange, "projectId" | "affectedSubjectIds"> {
  readonly href: string;
}

export interface PublicDigestKpiChange
  extends Omit<DigestKpiChange, "projectId" | "subjectId"> {
  readonly href: string;
}

export interface PersonalReviewTask {
  readonly id: string;
  readonly reviewDecisionId: string;
  readonly kind: TaskReviewKind;
  readonly projectId: string;
  readonly runId: string;
  readonly positionId: string;
  readonly title: string;
  readonly status: TaskReviewStatus;
  readonly priority: TaskReviewPriority;
  readonly dueAt: string | null;
  readonly href: string;
  readonly allowedActions: readonly PersonalTaskAction[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DigestComparisonMetric {
  readonly key: "SPECIFICATIONS" | "POSITIONS" | "KPI" | "TASKS";
  readonly current: number;
  readonly previous: number;
  readonly delta: number;
}

export interface DigestRecommendedAction {
  readonly id: string;
  readonly kind: "OPEN_TASK" | "REVIEW_POSITION" | "OPEN_SPECIFICATION" | "OPEN_ANALYTICS" | "OPEN_ANALYSIS" | "OPEN_DIGEST" | "OPEN_HELP";
  readonly label: string;
  readonly nextStep: string;
  readonly href: string;
}

export interface WeeklyDigest {
  readonly schemaVersion: "mtr-agent-weekly-digest-v1";
  readonly status: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
  readonly roleView: WeeklyDigestRoleView;
  readonly period: DigestPeriod;
  readonly previousPeriod: DigestPeriod;
  readonly generatedAt: string;
  readonly sources: Readonly<{
    specifications: DigestSourceState;
    positions: DigestSourceState;
    kpi: DigestSourceState;
    tasks: DigestSourceState;
  }>;
  readonly sections: Readonly<{
    specificationChanges: readonly PublicDigestSpecificationChange[];
    positionChanges: readonly PublicDigestPositionChange[];
    kpiChanges: readonly PublicDigestKpiChange[];
    tasks: readonly PersonalReviewTask[];
  }>;
  readonly comparison: readonly DigestComparisonMetric[];
  readonly recommendedActions: readonly [DigestRecommendedAction, DigestRecommendedAction, DigestRecommendedAction];
}

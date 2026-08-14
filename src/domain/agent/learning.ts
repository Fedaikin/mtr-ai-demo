export const AGENT_FEEDBACK_KINDS = [
  "USEFUL",
  "INCORRECT_FACT",
  "INCORRECT_CAUSE",
  "MISSING_FACTOR",
  "INCORRECT_FORECAST",
  "UNSUITABLE_RECOMMENDATION",
  "MISSING_SOURCE",
  "MISUNDERSTOOD_QUESTION",
  "UNSAFE_ACTION",
] as const;

export type AgentFeedbackKind = (typeof AGENT_FEEDBACK_KINDS)[number];

export const AGENT_LEARNING_CANDIDATE_STATUSES = [
  "QUARANTINED",
  "APPROVED",
  "PROMOTED",
  "REJECTED",
  "REVOKED",
] as const;

export type AgentLearningCandidateStatus =
  (typeof AGENT_LEARNING_CANDIDATE_STATUSES)[number];

export interface AgentLearningCandidate {
  readonly id: string;
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly responseMessageId: string;
  readonly caseId: string | null;
  readonly feedbackKind: AgentFeedbackKind;
  readonly status: AgentLearningCandidateStatus;
  readonly sanitizedSummary: string | null;
  readonly sourcePromptVersion: string;
  readonly sourceModelVersion: string;
  readonly sourceRuleVersions: readonly string[];
  readonly sourceEvidenceVersion: string;
  readonly applicability: Readonly<Record<string, unknown>> | null;
  readonly regressionCaseId: string | null;
  readonly validationChecksum: string | null;
  readonly validationSummary: string | null;
  readonly idempotencyKey: string;
  readonly authorizationVersion: number;
  readonly roleAssignmentSnapshot: readonly string[];
  readonly approvedByUserId: string | null;
  readonly promotedByUserId: string | null;
  readonly rejectedByUserId: string | null;
  readonly revokedByUserId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly approvedAt: string | null;
  readonly promotedAt: string | null;
  readonly rejectedAt: string | null;
  readonly revokedAt: string | null;
  readonly version: number;
}

export interface PublicAgentFeedbackReceipt {
  readonly candidateId: string;
  readonly feedbackKind: AgentFeedbackKind;
  readonly status: "QUARANTINED";
  readonly message: string;
}

export function toPublicAgentFeedbackReceipt(
  candidate: AgentLearningCandidate,
): PublicAgentFeedbackReceipt {
  return Object.freeze({
    candidateId: candidate.id,
    feedbackKind: candidate.feedbackKind,
    status: "QUARANTINED",
    message: "Отзыв сохранён для проверки специалистом и не изменяет работу агента автоматически.",
  });
}

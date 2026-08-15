export const TASK_REVIEW_STATUSES = [
  "AWAITING_ACCEPTANCE",
  "IN_PROGRESS",
  "REQUIRES_DECISION",
  "RETURNED_FOR_CLARIFICATION",
  "COMPLETED",
  "CANCELLED",
] as const;

export type TaskReviewStatus = (typeof TASK_REVIEW_STATUSES)[number];

export const TASK_REVIEW_PRIORITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const;

export type TaskReviewPriority = (typeof TASK_REVIEW_PRIORITIES)[number];

export const TASK_REVIEW_KINDS = [
  "ANALYSIS_REVIEW",
  "EXPERT_REVIEW",
  "DATA_CLARIFICATION",
  "TECHNICAL",
] as const;

export type TaskReviewKind = (typeof TASK_REVIEW_KINDS)[number];

export const PERSONAL_TASK_ACTIONS = [
  "OPEN",
  "ACCEPT",
  "START",
  "SUBMIT_FOR_REVIEW",
  "REQUEST_CLARIFICATION",
] as const;

export type PersonalTaskAction = (typeof PERSONAL_TASK_ACTIONS)[number];

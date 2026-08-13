import "server-only";

import { requirePermission } from "@/application/authorization-service";
import type { AgentExecutionContext } from "@/domain/agent/context";
import type { PersonalReviewTask } from "@/domain/agent/digest";
import type { AgentEvidenceAvailability, AgentMissingData } from "@/domain/agent/evidence";
import {
  TASK_REVIEW_PRIORITIES,
  TASK_REVIEW_STATUSES,
  type PersonalTaskAction,
  type TaskReviewPriority,
  type TaskReviewStatus,
} from "@/domain/agent/task-review";
import type {
  AnalysisReviewDecisionReadPort,
  AnalysisReviewDecisionTaskRecord,
} from "@/ports/agent-tasks";

const PRIORITY_WEIGHT: Readonly<Record<TaskReviewPriority, number>> = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
  CRITICAL: 3,
};

export interface PersonalTaskFilter {
  readonly projectId?: string;
  readonly statuses?: readonly TaskReviewStatus[];
  readonly priorities?: readonly TaskReviewPriority[];
}

export interface PersonalReviewTaskSnapshot {
  readonly snapshotAt: string;
  readonly availability: AgentEvidenceAvailability;
  readonly complete: boolean;
  readonly tasks: readonly PersonalReviewTask[];
  readonly missingData: readonly AgentMissingData[];
}

export class AgentTaskService {
  constructor(private readonly reviews: AnalysisReviewDecisionReadPort) {}

  async listPersonal(
    context: AgentExecutionContext,
    filter: PersonalTaskFilter = {},
  ): Promise<PersonalReviewTaskSnapshot> {
    requirePermission(context.trusted, "review.read");
    const projectId = context.trusted.activeProjectId;
    if (!projectId) throw new AgentTaskServiceError("AGENT_TASK_PROJECT_REQUIRED");
    if (filter.projectId && filter.projectId !== projectId) {
      throw new AgentTaskServiceError("AGENT_TASK_PROJECT_DENIED");
    }
    validateFilter(filter);

    const source = await this.reviews.list(context, {
      ownerSubjectId: context.trusted.subjectId,
      projectId,
    });
    const missingData = source.missingData.map((item) => ({
      code: safeIssueCode(item.code),
      message: "Источник решений доступен частично",
    }));
    let invalidRows = 0;
    const byId = new Map<string, PersonalReviewTask>();

    for (const row of source.items) {
      if (row.ownerSubjectId !== context.trusted.subjectId || row.projectId !== projectId) continue;
      const task = projectDecision(row);
      if (!task) {
        invalidRows += 1;
        continue;
      }
      if (filter.statuses && !filter.statuses.includes(task.status)) continue;
      if (filter.priorities && !filter.priorities.includes(task.priority)) continue;
      const previous = byId.get(task.id);
      if (!previous || compareTimestamp(task.updatedAt, previous.updatedAt) > 0) byId.set(task.id, task);
    }

    if (invalidRows > 0) {
      missingData.push({
        code: "ANALYSIS_REVIEW_ROWS_UNSUPPORTED",
        message: `Пропущено неподдерживаемых решений: ${invalidRows}`,
      });
    }
    const complete = source.complete && invalidRows === 0;
    const availability = effectiveAvailability(source.availability, complete);
    const tasks = [...byId.values()].sort(compareTasks);

    return Object.freeze({
      snapshotAt: source.snapshotAt,
      availability,
      complete,
      tasks: Object.freeze(tasks),
      missingData: Object.freeze(missingData),
    });
  }
}

export class AgentTaskServiceError extends Error {
  constructor(readonly code: "AGENT_TASK_PROJECT_REQUIRED" | "AGENT_TASK_PROJECT_DENIED" | "AGENT_TASK_INVALID_FILTER") {
    super("Контекст личных заданий недоступен");
    this.name = "AgentTaskServiceError";
  }
}

function projectDecision(row: AnalysisReviewDecisionTaskRecord): PersonalReviewTask | null {
  const projection = reviewState(row.status, row.doublecheckOutcome);
  if (!projection || !validTimestamp(row.createdAt) || !validTimestamp(row.updatedAt)) return null;
  const safePosition = safeLabel(row.positionId, "позицию");
  return Object.freeze({
    id: row.id,
    reviewDecisionId: row.id,
    kind: "ANALYSIS_REVIEW",
    projectId: row.projectId,
    runId: row.runId,
    positionId: row.positionId,
    title: `Проверить ${safePosition}`,
    status: projection.status,
    priority: projection.priority,
    dueAt: null,
    href: `/reviews?review=${encodeURIComponent(row.id)}`,
    allowedActions: projection.allowedActions,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function reviewState(
  status: string,
  outcome: string,
): Readonly<{
  status: TaskReviewStatus;
  priority: TaskReviewPriority;
  allowedActions: readonly PersonalTaskAction[];
}> | null {
  if (status === "CONFIRMED" || status === "REJECTED") {
    return { status: "COMPLETED", priority: "LOW", allowedActions: ["OPEN"] };
  }
  if (status === "RETURNED") {
    return {
      status: "RETURNED_FOR_CLARIFICATION",
      priority: "HIGH",
      allowedActions: ["OPEN"],
    };
  }
  if (status === "PENDING" || status === "AUTO_CONFIRMED") {
    return {
      status: "REQUIRES_DECISION",
      priority: outcome === "CONFIRMED_FOR_HUMAN_REVIEW" ? "NORMAL" : "HIGH",
      // `analysis_review_decisions` supports a dedicated human decision UI only.
      allowedActions: ["OPEN"],
    };
  }
  return null;
}

function validateFilter(filter: PersonalTaskFilter): void {
  const statuses = new Set<string>(TASK_REVIEW_STATUSES);
  const priorities = new Set<string>(TASK_REVIEW_PRIORITIES);
  if (filter.statuses?.some((status) => !statuses.has(status))) {
    throw new AgentTaskServiceError("AGENT_TASK_INVALID_FILTER");
  }
  if (filter.priorities?.some((priority) => !priorities.has(priority))) {
    throw new AgentTaskServiceError("AGENT_TASK_INVALID_FILTER");
  }
}

function effectiveAvailability(
  availability: AgentEvidenceAvailability,
  complete: boolean,
): AgentEvidenceAvailability {
  if (availability === "UNAVAILABLE") return "UNAVAILABLE";
  return complete && availability === "COMPLETE" ? "COMPLETE" : "PARTIAL";
}

function compareTasks(left: PersonalReviewTask, right: PersonalReviewTask): number {
  const priority = PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority];
  if (priority !== 0) return priority;
  return compareTimestamp(right.updatedAt, left.updatedAt) || left.id.localeCompare(right.id, "ru");
}

function compareTimestamp(left: string, right: string): number {
  const leftValue = Date.parse(left);
  const rightValue = Date.parse(right);
  if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) return left.localeCompare(right);
  return leftValue - rightValue;
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function safeLabel(value: string, fallback: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, "").trim();
  return normalized && normalized.length <= 120 ? normalized : fallback;
}

function safeIssueCode(value: string): string {
  return /^[A-Z][A-Z0-9_]{0,79}$/u.test(value) ? value : "ANALYSIS_REVIEW_SOURCE_PARTIAL";
}

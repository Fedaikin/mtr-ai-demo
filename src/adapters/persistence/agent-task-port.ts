import "server-only";

import type { MtrRepository } from "@/adapters/persistence/repository";
import type { AnalysisReviewDecisionReadPort } from "@/ports/agent-tasks";

export function createAnalysisReviewDecisionReadPort(
  repository: MtrRepository,
): AnalysisReviewDecisionReadPort {
  return {
    async list(context, query) {
      if (
        query.ownerSubjectId !== context.trusted.subjectId ||
        query.projectId !== context.trusted.activeProjectId
      ) {
        return {
          snapshotAt: new Date().toISOString(),
          availability: "UNAVAILABLE",
          complete: false,
          items: [],
          missingData: [{ code: "REVIEW_SCOPE_DENIED", message: "Источник заданий недоступен" }],
        };
      }
      const rows = await repository.listAnalysisReviewTasksInProject(
        query.ownerSubjectId,
        query.projectId,
      );
      const assignedTasks = await repository.listAgentAssignedTasksInProject(
        query.ownerSubjectId,
        query.projectId,
      );
      const snapshotAt = [...rows, ...assignedTasks].reduce(
        (latest, item) => Date.parse(item.updatedAt) > Date.parse(latest) ? item.updatedAt : latest,
        new Date().toISOString(),
      );
      return {
        snapshotAt,
        availability: "COMPLETE",
        complete: true,
        items: rows,
        assignedTasks: assignedTasks.map((task) => ({
          id: task.id,
          ownerSubjectId: task.assigneeUserId,
          projectId: task.projectId,
          reviewDecisionId: task.reviewDecisionId,
          kind: task.kind,
          status: task.status,
          priority: task.priority,
          title: task.title,
          resourceType: task.resourceType,
          resourceId: task.resourceId,
          allowedActions: task.allowedActions,
          dueAt: task.dueAt,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        })),
        missingData: [],
      };
    },
  };
}

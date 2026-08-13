import { createModelAnalyticalDatasetPort } from "@/adapters/mock/agent-analytical-dataset-port";
import { AnalyticalIntelligenceService } from "@/application/agent-orchestrator/analytics/analytical-intelligence-service";
import { AgentCommandExecutionError } from "@/domain/agent/errors";
import type { AnalyticalReadPort } from "@/ports/agent-orchestrator";

export function createModelAnalyticalReadPort(): AnalyticalReadPort {
  const service = new AnalyticalIntelligenceService(createModelAnalyticalDatasetPort());
  return {
    async analyze(context, query) {
      if (
        query.selection.projectId !== context.trusted.activeProjectId ||
        query.selection.validatedSubjectId !== context.trusted.subjectId ||
        query.selection.validatedAgainstAuthorizationVersion !== context.trusted.authorizationVersion
      ) {
        throw new AgentCommandExecutionError("AGENT_SELECTION_STALE");
      }
      if (!query.positionId) {
        throw new AgentCommandExecutionError("AGENT_POSITION_CONTEXT_REQUIRED");
      }
      return service.analyze({
        question: query.question,
        projectId: query.selection.projectId,
        positionId: query.positionId,
        horizonWeeks: query.horizonWeeks,
        demandMultiplier: query.demandMultiplier,
        deliveryDelayDays: query.deliveryDelayDays,
      });
    },
  };
}

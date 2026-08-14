import { z } from "zod";

import { createWeeklyDigestSourcePort } from "@/adapters/persistence/agent-digest-port";
import { createAnalysisReviewDecisionReadPort } from "@/adapters/persistence/agent-task-port";
import { getRepository } from "@/adapters/persistence/repository";
import { WeeklyDigestService, WeeklyDigestServiceError } from "@/application/agent-orchestrator/digest-service";
import { readAgentFeaturePolicy } from "@/application/agent-orchestrator/feature-policy";
import { AgentTaskService, AgentTaskServiceError } from "@/application/agent-orchestrator/task-service";
import { createAgentExecutionContext } from "@/domain/agent/context";
import { ApiError, ok, toErrorResponse } from "@/lib/api";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

const timezoneSchema = z.string().trim().min(1).max(100).default("Europe/Moscow");

export async function GET(request: Request) {
  try {
    assertEnabled();
    const timezone = timezoneSchema.parse(new URL(request.url).searchParams.get("timezone") ?? undefined);
    const [session, repository, sources] = await Promise.all([
      requirePermission("agent.chat"),
      getRepository(),
      createWeeklyDigestSourcePort(),
    ]);
    const context = createAgentExecutionContext(session.authorization, {
      selection: { projectId: session.authorization.activeProjectId ?? undefined },
      timezone,
    });
    const digest = await new WeeklyDigestService(
      sources,
      new AgentTaskService(createAnalysisReviewDecisionReadPort(repository)),
    ).generate(context);
    return ok(digest, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return digestErrorResponse(error);
  }
}

function assertEnabled(): void {
  const policy = readAgentFeaturePolicy();
  if (!policy.orchestratorEnabled) {
    throw new ApiError(404, "MTR_AGENT_ORCHESTRATOR_DISABLED", "Недельная сводка МТР-агента недоступна");
  }
  if (!policy.executionAllowed) {
    throw new ApiError(503, "MTR_AGENT_KILL_SWITCH_ACTIVE", "МТР-агент временно остановлен");
  }
}

function digestErrorResponse(error: unknown) {
  if (error instanceof WeeklyDigestServiceError || error instanceof AgentTaskServiceError) {
    return toErrorResponse(new ApiError(400, error.code, error.message));
  }
  return toErrorResponse(error);
}

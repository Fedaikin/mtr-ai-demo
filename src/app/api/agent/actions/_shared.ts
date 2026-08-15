import { z } from "zod";

import { createAgentActionStore } from "@/adapters/persistence/agent-action-store";
import { getRepository } from "@/adapters/persistence/repository";
import { PlatformAgentActionExecutor } from "@/application/agent-orchestrator/action-executor";
import { AgentActionError, AgentActionService } from "@/application/agent-orchestrator/action-service";
import { readAgentFeaturePolicy } from "@/application/agent-orchestrator/feature-policy";
import { scheduleScenarioRunDrain } from "@/application/scenario-background";
import { PROJECT_AGENT_ACTION_TYPES } from "@/domain/agent/actions";
import { ApiError, toErrorResponse } from "@/lib/api";

const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const actionProposalSchema = z.object({
  caseId: z.string().trim().min(1).max(200),
  actionType: z.enum(PROJECT_AGENT_ACTION_TYPES),
  resource: z.object({
    resourceType: z.string().trim().min(1).max(120),
    resourceId: z.string().trim().min(1).max(200),
    projectId: z.string().trim().min(1).max(200),
    ownerUserId: z.string().trim().min(1).max(200).optional(),
    status: z.string().trim().min(1).max(120).optional(),
    accessAttributes: z.record(z.string(), scalarSchema).optional(),
  }).strict(),
  summary: z.string().trim().min(1).max(300),
  consequences: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
  parameters: z.record(z.string(), scalarSchema).default({}),
  requestKey: z.string().trim().min(1).max(200),
}).strict();

export function assertActionsEnabled(): void {
  const policy = readAgentFeaturePolicy();
  if (!policy.actionsEnabled) {
    throw new ApiError(
      policy.executionAllowed ? 404 : 503,
      policy.executionAllowed ? "MTR_AGENT_ACTIONS_DISABLED" : "MTR_AGENT_KILL_SWITCH_ACTIVE",
      "Действия МТР-агента недоступны",
    );
  }
}

export function assertActionConfirmationAllowed(): void {
  const policy = readAgentFeaturePolicy();
  if (!policy.actionExecutionAllowed) {
    throw new ApiError(
      policy.actionsEnabled ? 409 : 503,
      policy.actionsEnabled ? "MTR_AGENT_ACTION_CONFIRMATION_DISABLED" : "MTR_AGENT_KILL_SWITCH_ACTIVE",
      "Подтверждение действий МТР-агента отключено",
    );
  }
}

export async function createActionService(): Promise<AgentActionService> {
  const [store, repository] = await Promise.all([createAgentActionStore(), getRepository()]);
  return new AgentActionService(
    store,
    new PlatformAgentActionExecutor(repository, { scheduleScenarioRun: scheduleScenarioRunDrain }),
  );
}

export function actionErrorResponse(error: unknown) {
  if (error instanceof AgentActionError) {
    const status = error.code === "ACTION_ACCESS_DENIED"
      ? 404
      : error.code === "ACTION_VALIDATION_ERROR"
        ? 400
        : error.code === "ACTION_EXECUTION_FAILED"
          ? 502
          : 409;
    return toErrorResponse(new ApiError(status, error.code, error.message));
  }
  return toErrorResponse(error);
}

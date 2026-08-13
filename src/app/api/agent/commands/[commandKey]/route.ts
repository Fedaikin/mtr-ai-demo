import { getRepository } from "@/adapters/persistence/repository";
import { AuthorizationError } from "@/application/authorization-service";
import { readAgentFeaturePolicy } from "@/application/agent-orchestrator/feature-policy";
import { projectAgentCommandResult } from "@/application/agent-orchestrator/public-projection";
import {
  AgentCommandExecutionError,
} from "@/application/agent-orchestrator/command-registry";
import {
  parseAgentCommandRequest,
  AgentCommandInputError,
} from "@/application/agent-orchestrator/command-schemas";
import type { AgentCommandOrchestratorRequest } from "@/application/agent-orchestrator/orchestrator";
import { AgentContextError } from "@/domain/agent/context";
import type { AgentCommandKey } from "@/domain/agent/commands";
import type { AgentCommandRequestMap } from "@/ports/agent-orchestrator";
import { ApiError, ok, parseJson, toErrorResponse } from "@/lib/api";
import { requirePermission } from "@/lib/session";

import { createMtrAgentOrchestrator } from "../../_shared";

export const dynamic = "force-dynamic";

interface CommandRouteContext {
  readonly params: Promise<{ commandKey: string }>;
}

export async function POST(request: Request, { params }: CommandRouteContext) {
  try {
    assertFeatureEnabled();
    const [routeParams, body, session, repository] = await Promise.all([
      params,
      parseJson(request),
      requirePermission("agent.chat"),
      getRepository(),
    ]);
    const input = parseAgentCommandRequest(routeParams.commandKey, body);
    const correlationId = `agent-command-${crypto.randomUUID()}`;
    const orchestrator = createMtrAgentOrchestrator(repository);
    const result = await orchestrator.handle(
      toOrchestratorRequest(input.commandKey, input.context, input.filters, correlationId),
      session.authorization,
    );
    if (result.kind !== "COMMAND") {
      throw new Error("COMMAND_CHANNEL_RESULT_MISMATCH");
    }
    return ok({
      result: projectAgentCommandResult(result.output, correlationId),
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return commandErrorResponse(error);
  }
}

function toOrchestratorRequest<K extends AgentCommandKey>(
  commandKey: K,
  selection: AgentCommandRequestMap[K]["context"],
  filters: AgentCommandRequestMap[K]["filters"] | undefined,
  correlationId: string,
): AgentCommandOrchestratorRequest {
  return {
    kind: "COMMAND",
    commandKey,
    selection,
    ...(filters === undefined ? {} : { filters }),
    correlationId,
  } as AgentCommandOrchestratorRequest;
}

function assertFeatureEnabled(): void {
  const policy = readAgentFeaturePolicy();
  if (!policy.orchestratorEnabled) {
    throw new ApiError(404, "MTR_AGENT_ORCHESTRATOR_DISABLED", "Команды МТР-агента недоступны");
  }
  if (!policy.executionAllowed) {
    throw new ApiError(503, "MTR_AGENT_KILL_SWITCH_ACTIVE", "Выполнение команд МТР-агента временно остановлено");
  }
}

function commandErrorResponse(error: unknown) {
  if (error instanceof AgentCommandInputError) {
    return toErrorResponse(new ApiError(404, error.code, error.message));
  }
  if (error instanceof AgentContextError) {
    return toErrorResponse(new ApiError(403, error.code, error.message));
  }
  if (error instanceof AuthorizationError) {
    return toErrorResponse(new ApiError(403, "AGENT_PERMISSION_DENIED", error.message));
  }
  if (error instanceof AgentCommandExecutionError) {
    const status = error.code === "AGENT_COMMAND_NOT_REGISTERED"
      ? 404
      : error.code === "AGENT_SELECTION_STALE"
        ? 409
        : 403;
    return toErrorResponse(new ApiError(status, error.code, error.message));
  }
  return toErrorResponse(error);
}

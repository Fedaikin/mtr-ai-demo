import { createAgentCommandHandlers, type AgentCommandHandlerMap } from "@/application/agent-orchestrator/command-handlers";
import {
  getAgentCommand,
  isAgentCommandAllowed,
  type AgentCommandKey,
} from "@/domain/agent/commands";
import type { AgentContextSelection, AgentExecutionContext } from "@/domain/agent/context";
import { AgentCommandExecutionError } from "@/domain/agent/errors";
import type {
  AgentCommandRequestMap,
  AgentCommandResultMap,
  AgentOrchestratorPorts,
  ValidatedAgentSelection,
} from "@/ports/agent-orchestrator";

export { AgentCommandExecutionError } from "@/domain/agent/errors";

export class AgentCommandRegistry {
  constructor(private readonly handlers: AgentCommandHandlerMap) {}

  async execute<K extends AgentCommandKey>(
    context: AgentExecutionContext,
    request: AgentCommandRequestMap[K] & { readonly commandKey: K },
  ): Promise<AgentCommandResultMap[K]> {
    const definition = getAgentCommand(request.commandKey);
    if (!definition || definition.key !== request.commandKey) {
      throw new AgentCommandExecutionError("AGENT_COMMAND_NOT_REGISTERED");
    }
    if (!isAgentCommandAllowed(context.trusted, definition)) {
      throw new AgentCommandExecutionError("AGENT_COMMAND_FORBIDDEN");
    }

    const selection = validateSelection(context, request.context);
    const handler = this.handlers[request.commandKey] as AgentCommandHandlerMap[K];
    return handler.execute(context, request, selection);
  }
}

export function createAgentCommandRegistry(
  ports: AgentOrchestratorPorts,
): AgentCommandRegistry {
  return new AgentCommandRegistry(createAgentCommandHandlers(ports));
}

function validateSelection(
  context: AgentExecutionContext,
  requested: AgentContextSelection,
): ValidatedAgentSelection {
  const trustedProjectId = context.trusted.activeProjectId;
  if (!trustedProjectId) {
    throw new AgentCommandExecutionError("AGENT_PROJECT_CONTEXT_REQUIRED");
  }
  if (
    context.selection.projectId !== undefined &&
    context.selection.projectId !== trustedProjectId
  ) {
    throw new AgentCommandExecutionError("AGENT_SELECTION_STALE");
  }
  if (requested.projectId !== undefined && requested.projectId !== trustedProjectId) {
    throw new AgentCommandExecutionError("AGENT_SELECTION_STALE");
  }

  assertValidatedField(requested.specificationId, context.selection.specificationId);
  assertValidatedField(requested.positionId, context.selection.positionId);
  assertValidatedField(requested.runId, context.selection.runId);
  if (requested.period !== undefined && !samePeriod(requested.period, context.selection.period)) {
    throw new AgentCommandExecutionError("AGENT_SELECTION_STALE");
  }

  return Object.freeze({
    projectId: trustedProjectId,
    specificationId: context.selection.specificationId,
    positionId: context.selection.positionId,
    runId: context.selection.runId,
    period: context.selection.period,
    validatedSubjectId: context.trusted.subjectId,
    validatedAgainstAuthorizationVersion: context.trusted.authorizationVersion,
    validationRequestId: context.trusted.requestId,
  });
}

function assertValidatedField(
  requested: string | undefined,
  validated: string | undefined,
): void {
  if (requested !== undefined && requested !== validated) {
    throw new AgentCommandExecutionError("AGENT_SELECTION_STALE");
  }
}

function samePeriod(
  requested: Readonly<{ from: string; to: string }>,
  validated: Readonly<{ from: string; to: string }> | undefined,
): boolean {
  return requested.from === validated?.from && requested.to === validated.to;
}

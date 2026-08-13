import "server-only";

import { z } from "zod";

import {
  requirePermission,
  type TrustedRequestContext,
} from "@/application/authorization-service";
import {
  agentInputSchema,
  type TrustedAgentRequest,
} from "@/application/agent-service";
import type { AgentCommandKey } from "@/domain/agent/commands";
import {
  createAgentExecutionContext,
  type AgentContextSelection,
  type AgentExecutionContext,
} from "@/domain/agent/context";
import type { GroundedAgentOutput } from "@/domain/models";
import type {
  AgentCommandRequestMap,
  AgentCommandResultMap,
  AgentOrchestratorCommandResult,
} from "@/ports/agent-orchestrator";

const periodSchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
  })
  .strict()
  .refine((period) => Date.parse(period.from) < Date.parse(period.to), {
    message: "Начало периода должно быть раньше окончания",
  });

export const agentContextSelectionSchema = z
  .object({
    projectId: z.string().trim().min(1).max(200).optional(),
    specificationId: z.string().trim().min(1).max(200).optional(),
    positionId: z.string().trim().min(1).max(200).optional(),
    runId: z.string().trim().min(1).max(200).optional(),
    period: periodSchema.optional(),
  })
  .strict();

/** Public chat body: selection is untrusted; identity and grants are deliberately absent. */
export const agentChatInputSchema = agentInputSchema
  .extend({ selection: agentContextSelectionSchema.optional() })
  .strict();

export type AgentChatInput = z.output<typeof agentChatInputSchema>;

export interface AgentChatOrchestratorRequest {
  readonly kind: "CHAT";
  readonly message: string;
  readonly threadId?: string;
  readonly selection?: AgentContextSelection;
  readonly correlationId?: string;
  readonly promptVersion?: string;
}

type AgentCommandOrchestratorEnvelope<K extends AgentCommandKey> = {
  readonly kind: "COMMAND";
  readonly commandKey: K;
  readonly selection?: AgentContextSelection;
  readonly filters?: AgentCommandRequestMap[K]["filters"];
  readonly correlationId?: string;
};

export type AgentCommandOrchestratorRequest = {
  readonly [K in AgentCommandKey]: AgentCommandOrchestratorEnvelope<K>;
}[AgentCommandKey];

export interface AgentEventOrchestratorRequest {
  readonly kind: "EVENT";
  readonly eventType: string;
  readonly entityId: string;
  readonly occurredAt: string;
  readonly selection?: AgentContextSelection;
  readonly correlationId?: string;
}

export type MtrAgentOrchestratorRequest =
  | AgentChatOrchestratorRequest
  | AgentCommandOrchestratorRequest
  | AgentEventOrchestratorRequest;

export type AgentChatOrchestratorResult = Readonly<{
  kind: "CHAT";
  output: GroundedAgentOutput;
}>;

export type AgentCommandOrchestratorResult = Readonly<{
  kind: "COMMAND";
  output: AgentOrchestratorCommandResult;
}>;

export type MtrAgentOrchestratorResult =
  | AgentChatOrchestratorResult
  | AgentCommandOrchestratorResult;

export interface LegacyAgentCapability {
  respond(request: TrustedAgentRequest): Promise<GroundedAgentOutput>;
}

export interface AgentCommandCapability {
  execute<K extends AgentCommandKey>(
    context: AgentExecutionContext,
    request: AgentCommandRequestMap[K] & { readonly commandKey: K },
  ): Promise<AgentCommandResultMap[K]>;
}

/**
 * Single application seam for every MTR-agent entry channel.
 * All entry channels share this authorization/context boundary. EVENT remains
 * explicitly closed until its capability is injected.
 */
export class MtrAgentOrchestrator {
  constructor(
    private readonly legacyChat: LegacyAgentCapability,
    private readonly commands?: AgentCommandCapability,
  ) {}

  async handle(
    request: AgentChatOrchestratorRequest,
    authorization: TrustedRequestContext,
  ): Promise<AgentChatOrchestratorResult>;
  async handle(
    request: AgentCommandOrchestratorRequest,
    authorization: TrustedRequestContext,
  ): Promise<AgentCommandOrchestratorResult>;
  async handle(
    request: MtrAgentOrchestratorRequest,
    authorization: TrustedRequestContext,
  ): Promise<MtrAgentOrchestratorResult>;
  async handle(
    request: MtrAgentOrchestratorRequest,
    authorization: TrustedRequestContext,
  ): Promise<MtrAgentOrchestratorResult> {
    if (request.kind === "EVENT") {
      throw new AgentOrchestratorChannelUnavailableError("EVENT");
    }

    const executionContext = createAgentExecutionContext(authorization, {
      selection: request.selection,
      correlationId: request.correlationId,
    });

    if (request.kind === "COMMAND") {
      if (!this.commands) {
        throw new AgentOrchestratorChannelUnavailableError("COMMAND");
      }
      const output = await executeCommand(this.commands, executionContext, request);
      return Object.freeze({ kind: "COMMAND", output });
    }

    requirePermission(authorization, "agent.chat");

    const output = await this.legacyChat.respond({
      message: request.message,
      ...(request.threadId === undefined ? {} : { threadId: request.threadId }),
      userId: executionContext.trusted.subjectId,
      correlationId: executionContext.correlationId,
      ...(request.promptVersion === undefined ? {} : { promptVersion: request.promptVersion }),
    });

    return Object.freeze({ kind: "CHAT", output });
  }
}

function executeCommand(
  capability: AgentCommandCapability,
  context: AgentExecutionContext,
  request: AgentCommandOrchestratorRequest,
): Promise<AgentOrchestratorCommandResult> {
  switch (request.commandKey) {
    case "SUMMARY":
      return capability.execute(context, commandRequest("SUMMARY", request));
    case "MY_TASKS":
      return capability.execute(context, commandRequest("MY_TASKS", request));
    case "RISKS":
      return capability.execute(context, commandRequest("RISKS", request));
    case "STOCKS":
      return capability.execute(context, commandRequest("STOCKS", request));
    case "KPI":
      return capability.execute(context, commandRequest("KPI", request));
  }
}

function commandRequest<K extends AgentCommandKey>(
  commandKey: K,
  request: AgentCommandOrchestratorEnvelope<K>,
): AgentCommandRequestMap[K] & { readonly commandKey: K } {
  return {
    commandKey,
    context: request.selection ?? {},
    ...(request.filters === undefined ? {} : { filters: request.filters }),
  } as unknown as AgentCommandRequestMap[K] & { readonly commandKey: K };
}

export class AgentOrchestratorChannelUnavailableError extends Error {
  constructor(readonly channel: Exclude<MtrAgentOrchestratorRequest["kind"], "CHAT">) {
    super("Канал МТР-агента пока недоступен");
    this.name = "AgentOrchestratorChannelUnavailableError";
  }
}

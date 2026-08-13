import "server-only";

import { z } from "zod";

import {
  requirePermission,
  type TrustedRequestContext,
} from "@/application/authorization-service";
import {
  type TrustedAgentRequest,
} from "@/application/agent-service";
import type { AgentCommandKey } from "@/domain/agent/commands";
import type { PublicAgentProactiveInsight } from "@/domain/agent/events";
import {
  createAgentExecutionContext,
  type AgentContextSelection,
  type AgentExecutionContext,
} from "@/domain/agent/context";
import type { GroundedAgentOutput } from "@/domain/models";
import type {
  UniversalAgentAnswer,
  UniversalClarification,
} from "@/domain/agent/universal-chat/answer";
import type {
  AgentCommandRequestMap,
  AgentCommandResultMap,
  AgentOrchestratorCommandResult,
} from "@/ports/agent-orchestrator";
import {
  routeNaturalAgentCommand,
  type NaturalAgentCommand,
} from "@/application/agent-orchestrator/natural-command-router";

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

export const agentAttachmentRefSchema = z.object({
  uploadId: z.string().trim().min(1).max(200),
  purpose: z.enum(["SPECIFICATION", "SAP_IMPORT", "REFERENCE", "AUTO"]),
}).strict();

/** Public chat body: selection is untrusted; identity and grants are deliberately absent. */
export const agentChatInputSchema = z.object({
  message: z.string().trim().max(4_000).default(""),
  threadId: z.string().trim().min(1).max(160).optional(),
  selection: agentContextSelectionSchema.optional(),
  attachments: z.array(agentAttachmentRefSchema).max(4).optional(),
}).strict().refine(
  (input) => input.message.length > 0 || (input.attachments?.length ?? 0) > 0,
  { message: "Введите сообщение или приложите файл" },
);

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
  readonly eventId: string;
  readonly eventType: string;
  readonly entityId: string;
  readonly stateVersion: string;
  readonly occurredAt: string;
  readonly selection?: AgentContextSelection;
  readonly correlationId?: string;
}

export type MtrAgentOrchestratorRequest =
  | AgentChatOrchestratorRequest
  | AgentCommandOrchestratorRequest
  | AgentEventOrchestratorRequest;

export type AgentCommandOrchestratorResult = Readonly<{
  kind: "COMMAND";
  output: AgentOrchestratorCommandResult;
}>;

export type AgentChatOrchestratorResult = Readonly<{
  kind: "CHAT";
  output: GroundedAgentOutput;
}> | AgentCommandOrchestratorResult | UniversalAgentOrchestratorResult;

export type UniversalAgentOrchestratorResult = Readonly<{
  kind: "UNIVERSAL";
  output: UniversalAgentAnswer | UniversalClarification;
}>;

export type AgentEventOrchestratorResult = Readonly<{
  kind: "EVENT";
  output: PublicAgentProactiveInsight;
}>;

export type MtrAgentOrchestratorResult =
  | AgentChatOrchestratorResult
  | AgentCommandOrchestratorResult
  | AgentEventOrchestratorResult;

export interface LegacyAgentCapability {
  respond(request: TrustedAgentRequest): Promise<GroundedAgentOutput>;
}

export interface AgentCommandCapability {
  execute<K extends AgentCommandKey>(
    context: AgentExecutionContext,
    request: AgentCommandRequestMap[K] & { readonly commandKey: K },
  ): Promise<AgentCommandResultMap[K]>;
}

export interface AgentEventCapability {
  execute(
    context: AgentExecutionContext,
    request: AgentEventOrchestratorRequest,
  ): Promise<PublicAgentProactiveInsight>;
}

export interface UniversalAgentCapability {
  respond(
    request: AgentChatOrchestratorRequest,
    context: AgentExecutionContext,
  ): Promise<UniversalAgentAnswer | UniversalClarification | null>;
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
    private readonly events?: AgentEventCapability,
    private readonly universalChat?: UniversalAgentCapability,
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
    request: AgentEventOrchestratorRequest,
    authorization: TrustedRequestContext,
  ): Promise<AgentEventOrchestratorResult>;
  async handle(
    request: MtrAgentOrchestratorRequest,
    authorization: TrustedRequestContext,
  ): Promise<MtrAgentOrchestratorResult>;
  async handle(
    request: MtrAgentOrchestratorRequest,
    authorization: TrustedRequestContext,
  ): Promise<MtrAgentOrchestratorResult> {
    const executionContext = createAgentExecutionContext(authorization, {
      selection: request.selection,
      correlationId: request.correlationId,
    });

    if (request.kind === "EVENT") {
      if (!this.events) throw new AgentOrchestratorChannelUnavailableError("EVENT");
      const output = await this.events.execute(executionContext, request);
      return Object.freeze({ kind: "EVENT", output });
    }

    if (request.kind === "COMMAND") {
      if (!this.commands) {
        throw new AgentOrchestratorChannelUnavailableError("COMMAND");
      }
      const output = await executeCommand(this.commands, executionContext, request);
      return Object.freeze({ kind: "COMMAND", output });
    }

    requirePermission(authorization, "agent.chat");

    const naturalCommand = this.commands
      ? routeNaturalAgentCommand(request.message, request.selection)
      : null;
    if (naturalCommand && shouldPreferTypedCommand(naturalCommand)) {
      const output = await executeNaturalCommand(
        this.commands!,
        executionContext,
        naturalCommand,
        request.correlationId,
      );
      return Object.freeze({ kind: "COMMAND", output });
    }

    if (isDirectSapStockQuery(request.message)) {
      const output = await executeLegacyChat(this.legacyChat, request, executionContext);
      return Object.freeze({ kind: "CHAT", output });
    }

    if (this.universalChat) {
      const universal = await this.universalChat.respond(request, executionContext);
      if (universal) return Object.freeze({ kind: "UNIVERSAL", output: universal });
    }

    if (naturalCommand) {
      const output = await executeNaturalCommand(
        this.commands!,
        executionContext,
        naturalCommand,
        request.correlationId,
      );
      return Object.freeze({ kind: "COMMAND", output });
    }

    const output = await executeLegacyChat(this.legacyChat, request, executionContext);

    return Object.freeze({ kind: "CHAT", output });
  }
}

function executeLegacyChat(
  capability: LegacyAgentCapability,
  request: AgentChatOrchestratorRequest,
  context: AgentExecutionContext,
): Promise<GroundedAgentOutput> {
  return capability.respond({
      message: request.message,
      ...(request.threadId === undefined ? {} : { threadId: request.threadId }),
      userId: context.trusted.subjectId,
      correlationId: context.correlationId,
      ...(request.promptVersion === undefined ? {} : { promptVersion: request.promptVersion }),
    });
}

function shouldPreferTypedCommand(command: NaturalAgentCommand): boolean {
  return command.commandKey === "ANALYSIS";
}

function isDirectSapStockQuery(message: string): boolean {
  return /\bSAP-[A-Z0-9-]+\b/iu.test(message)
    && /как(?:ов|ой)\s+(?:текущ\p{L}*\s+)?остаток\s+материал/iu.test(message);
}

function executeNaturalCommand(
  capability: AgentCommandCapability,
  context: AgentExecutionContext,
  command: NaturalAgentCommand,
  correlationId?: string,
): Promise<AgentOrchestratorCommandResult> {
  return executeCommand(capability, context, {
    kind: "COMMAND",
    commandKey: command.commandKey,
    selection: command.selection,
    ...(command.filters === undefined ? {} : { filters: command.filters }),
    ...(correlationId === undefined ? {} : { correlationId }),
  } as AgentCommandOrchestratorRequest);
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
    case "ANALYSIS":
      return capability.execute(context, commandRequest("ANALYSIS", request));
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

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
} from "@/domain/agent/context";
import type { GroundedAgentOutput } from "@/domain/models";

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

export interface AgentCommandOrchestratorRequest {
  readonly kind: "COMMAND";
  readonly commandKey: AgentCommandKey;
  readonly selection?: AgentContextSelection;
  readonly filters?: Readonly<Record<string, unknown>>;
  readonly correlationId?: string;
}

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

export type MtrAgentOrchestratorResult = Readonly<{
  kind: "CHAT";
  output: GroundedAgentOutput;
}>;

export interface LegacyAgentCapability {
  respond(request: TrustedAgentRequest): Promise<GroundedAgentOutput>;
}

/**
 * Single application seam for every MTR-agent entry channel.
 * Only CHAT is enabled in this increment; COMMAND and EVENT are explicit closed branches.
 */
export class MtrAgentOrchestrator {
  constructor(private readonly legacyChat: LegacyAgentCapability) {}

  async handle(
    request: MtrAgentOrchestratorRequest,
    authorization: TrustedRequestContext,
  ): Promise<MtrAgentOrchestratorResult> {
    if (request.kind !== "CHAT") {
      throw new AgentOrchestratorChannelUnavailableError(request.kind);
    }

    requirePermission(authorization, "agent.chat");
    const executionContext = createAgentExecutionContext(authorization, {
      selection: request.selection,
      correlationId: request.correlationId,
    });

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

export class AgentOrchestratorChannelUnavailableError extends Error {
  constructor(readonly channel: Exclude<MtrAgentOrchestratorRequest["kind"], "CHAT">) {
    super("Канал МТР-агента пока недоступен");
    this.name = "AgentOrchestratorChannelUnavailableError";
  }
}

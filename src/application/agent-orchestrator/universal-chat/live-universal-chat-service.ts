import "server-only";

import type { AgentExecutionContext } from "@/domain/agent/context";
import type {
  UniversalAgentAnswer,
} from "@/domain/agent/universal-chat/answer";

import type { UniversalCapabilityRegistry } from "./capability-registry";
import {
  OpenAIResponsesPlanner,
  OpenAIResponsesPlannerError,
  parsePlannerCapabilityInput,
  type UniversalPlannerTrace,
} from "./live-planner";
import type {
  UniversalChatService,
  UniversalChatServiceRequest,
  UniversalChatServiceResult,
} from "./universal-chat-service";

const MAX_CALLS = 12;
const MAX_PARALLEL = 3;

export interface LiveUniversalChatAuditPort {
  write(
    context: AgentExecutionContext,
    event: Readonly<{
      outcome: "SUCCESS" | "FALLBACK";
      safeErrorCode?: string;
      trace?: UniversalPlannerTrace;
    }>,
  ): Promise<void>;
}

export class LiveUniversalChatService {
  constructor(
    private readonly planner: OpenAIResponsesPlanner,
    private readonly capabilities: UniversalCapabilityRegistry,
    private readonly deterministic: UniversalChatService,
    private readonly systemPrompt: string,
    private readonly audit?: LiveUniversalChatAuditPort,
  ) {}

  async respond(
    request: UniversalChatServiceRequest,
    context: AgentExecutionContext,
  ): Promise<UniversalChatServiceResult> {
    let plannerTrace: UniversalPlannerTrace | undefined;
    try {
      const planned = await this.planner.plan(request.message, context, this.systemPrompt);
      plannerTrace = planned.trace;
      if (planned.decision.kind === "ASK_CLARIFICATION") {
        await this.audit?.write(context, { outcome: "SUCCESS", trace: planned.trace });
        return {
          kind: "ASK_CLARIFICATION",
          question: planned.decision.question,
          candidates: [],
        };
      }
      const results = planned.decision.kind === "CALL_CAPABILITIES"
        ? await this.executeCalls(planned.decision.calls, context)
        : [];
      const deterministic = await this.deterministic.respond(request, context);
      if (!deterministic || "kind" in deterministic) {
        await this.audit?.write(context, { outcome: "SUCCESS", trace: planned.trace });
        return deterministic;
      }
      const composed = await this.planner.compose(
        deterministic,
        results,
        context,
        this.systemPrompt,
      );
      const output = mergeVerifiedProse(deterministic, composed.decision, composed.trace);
      await this.audit?.write(context, { outcome: "SUCCESS", trace: composed.trace });
      return output;
    } catch (error) {
      const safeErrorCode = error instanceof OpenAIResponsesPlannerError
        ? error.code
        : "OPENAI_LIVE_RUNTIME_FAILED";
      await this.audit?.write(context, {
        outcome: "FALLBACK",
        safeErrorCode,
        ...(plannerTrace ? { trace: plannerTrace } : {}),
      });
      return this.deterministic.respond(request, context);
    }
  }

  private async executeCalls(
    calls: ReadonlyArray<Readonly<{
      capabilityKey: Parameters<UniversalCapabilityRegistry["execute"]>[0];
      argumentsJson: string;
    }>>,
    context: AgentExecutionContext,
  ): Promise<readonly unknown[]> {
    if (calls.length > MAX_CALLS) throw new OpenAIResponsesPlannerError("OPENAI_TOOL_BUDGET_EXCEEDED");
    const results: unknown[] = [];
    for (let index = 0; index < calls.length; index += MAX_PARALLEL) {
      const batch = calls.slice(index, index + MAX_PARALLEL);
      results.push(...await Promise.all(batch.map(async (call) => ({
        capabilityKey: call.capabilityKey,
        result: await this.capabilities.execute(
          call.capabilityKey,
          context,
          parsePlannerCapabilityInput(call),
        ),
      }))));
    }
    return Object.freeze(results);
  }
}

function mergeVerifiedProse(
  source: UniversalAgentAnswer,
  prose: Readonly<{
    summary: string;
    riskExplanations: readonly Readonly<{ id: string; explanation: string }>[];
    recommendationExplanations: readonly Readonly<{ id: string; explanation: string }>[];
  }>,
  trace: UniversalPlannerTrace,
): UniversalAgentAnswer {
  void prose;
  return Object.freeze({
    ...source,
    // The model participates in planning/composition, but deterministic facts,
    // verdicts and factual prose remain the canonical public truth in G3.
    summary: source.summary,
    risks: source.risks.map((item) => ({ ...item })),
    recommendations: source.recommendations.map((item) => ({ ...item })),
    mode: "PRIMARY_LLM",
    runtime: {
      provider: "OPENAI" as const,
      model: trace.model,
      providerVersion: trace.providerVersion,
      promptVersion: trace.promptVersion,
    },
  });
}

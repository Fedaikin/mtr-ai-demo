import "server-only";

import type {
  IntegrationStateRecord,
  MtrRepository,
} from "@/adapters/persistence/repository";
import type { GroundedAgentOutput } from "@/domain/models";
import type {
  GroundedAgentInput,
  LlmProviderRequestOptions,
  LLMProvider,
} from "@/ports";

type LlmStateRepository = Pick<MtrRepository, "getIntegrationState">;

export class LlmIntegrationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly safeMessage: string,
  ) {
    super(safeMessage);
    this.name = "LlmIntegrationError";
  }
}

/** Makes the admin LLM state an executable failure/latency control. */
export class IntegrationAwareLlmProvider implements LLMProvider {
  constructor(
    private readonly repository: LlmStateRepository,
    private readonly provider: LLMProvider,
  ) {}

  async respond(
    input: GroundedAgentInput,
    options: LlmProviderRequestOptions = {},
  ): Promise<GroundedAgentOutput> {
    const state = await this.requireState(input.userId);
    if (state.state === "SLOW") await controlledDelay(state.delayMs, options.signal);
    if (state.state !== "AVAILABLE" && state.state !== "SLOW") {
      throw new LlmIntegrationError(
        state.state === "RATE_LIMITED" ? 429 : 503,
        `LLM_${state.state}`,
        state.safeMessage ?? safeStateMessage(state.state),
      );
    }
    return this.provider.respond(input, options);
  }

  private async requireState(userId: string): Promise<IntegrationStateRecord> {
    const state = await this.repository.getIntegrationState(userId, "LLM");
    if (!state) {
      throw new LlmIntegrationError(
        503,
        "LLM_STATE_NOT_CONFIGURED",
        "Состояние LLM-провайдера не настроено.",
      );
    }
    return state;
  }
}

async function controlledDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  const safeDelay = Math.max(0, Math.min(10_000, Math.trunc(delayMs)));
  if (signal?.aborted) throw new LlmIntegrationError(499, "LLM_CANCELLED", "Формирование ответа отменено.");
  if (safeDelay > 0) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, safeDelay);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new LlmIntegrationError(499, "LLM_CANCELLED", "Формирование ответа отменено."));
      }, { once: true });
    });
  }
}

function safeStateMessage(state: string): string {
  if (state === "RATE_LIMITED") return "LLM-провайдер временно ограничил частоту запросов.";
  if (state === "MALFORMED_RESPONSE") return "Ответ LLM-провайдера не прошёл проверку контракта.";
  return "LLM-провайдер временно недоступен.";
}

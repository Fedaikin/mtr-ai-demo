import type { GroundedAgentOutput } from "@/domain/models";
import {
  ConformingLlmProvider,
  LlmProviderBoundaryError,
  type LlmProviderConformancePolicy,
} from "@/application/agent-orchestrator/provider-conformance";
import type { GroundedAgentInput, LLMProvider } from "@/ports";

const validOutput: GroundedAgentOutput = {
  answer: "Подтверждённый ответ.",
  facts: ["Факт"],
  recommendations: [],
  citations: [],
  confidence: 0.8,
  requiresHumanReview: false,
  toolCalls: [],
};

function policy(
  overrides: Partial<LlmProviderConformancePolicy> = {},
): LlmProviderConformancePolicy {
  return {
    provider: "OFFLINE_DETERMINISTIC",
    model: "mtr-grounded-demo",
    version: "1.0.0",
    timeoutMs: 100,
    maxInputTokens: 10_000,
    maxOutputTokens: 10_000,
    maxRequestCostUsd: 0,
    requestsPerMinute: 60,
    trainingAllowed: false,
    retentionAllowed: false,
    enabled: () => true,
    ...overrides,
  };
}

function input(message = "Покажи остаток"): GroundedAgentInput {
  return {
    userId: "demo-user-001",
    message,
    threadId: "thread-001",
    facts: [
      {
        source: "SAP.stock",
        payload: {
          materialCode: "SAP-DEMO-0001",
          apiToken: "top-secret-token",
          note: "Bearer abcdefghijklmnop",
        },
      },
    ],
  };
}

describe("ConformingLlmProvider", () => {
  it("редактирует секреты до вызова провайдера и объявляет запрет обучения/хранения", async () => {
    let received: GroundedAgentInput | undefined;
    const delegate: LLMProvider = {
      respond: async (value) => {
        received = value;
        return validOutput;
      },
    };
    const provider = new ConformingLlmProvider(delegate, policy());

    await expect(provider.respond(input("token=secret-value Покажи остаток"))).resolves.toEqual(validOutput);

    expect(provider.metadata).toMatchObject({
      provider: "OFFLINE_DETERMINISTIC",
      model: "mtr-grounded-demo",
      version: "1.0.0",
      trainingAllowed: false,
      retentionAllowed: false,
    });
    expect(received?.message).not.toContain("secret-value");
    expect(JSON.stringify(received?.facts)).not.toContain("top-secret-token");
    expect(JSON.stringify(received?.facts)).not.toContain("abcdefghijklmnop");
    expect(received?.userId).toBe("demo-user-001");
  });

  it("kill switch и входной бюджет останавливают вызов до провайдера", async () => {
    let calls = 0;
    const delegate: LLMProvider = {
      respond: async () => {
        calls += 1;
        return validOutput;
      },
    };

    await expect(
      new ConformingLlmProvider(delegate, policy({ enabled: () => false })).respond(input()),
    ).rejects.toMatchObject({ code: "LLM_PROVIDER_DISABLED" });
    await expect(
      new ConformingLlmProvider(delegate, policy({ maxInputTokens: 1 })).respond(input()),
    ).rejects.toMatchObject({ code: "LLM_INPUT_BUDGET_EXCEEDED" });
    expect(calls).toBe(0);
  });

  it("отменяет зависший вызов по таймауту и возвращает только безопасную ошибку", async () => {
    let aborted = false;
    const delegate: LLMProvider = {
      respond: (_value, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("raw provider timeout with credential=secret"));
          });
        }),
    };
    const provider = new ConformingLlmProvider(delegate, policy({ timeoutMs: 5 }));

    const failure = await provider.respond(input()).catch((error: unknown) => error);

    expect(aborted).toBe(true);
    expect(failure).toBeInstanceOf(LlmProviderBoundaryError);
    expect(failure).toMatchObject({ code: "LLM_PROVIDER_TIMEOUT" });
    expect(String(failure)).not.toContain("credential");
    expect(String(failure)).not.toContain("secret");
  });

  it("отклоняет невалидный или слишком большой ответ на границе", async () => {
    const malformed: LLMProvider = {
      respond: async () => ({ ...validOutput, confidence: 7 }),
    };
    await expect(
      new ConformingLlmProvider(malformed, policy()).respond(input()),
    ).rejects.toMatchObject({ code: "LLM_OUTPUT_INVALID" });

    const oversized: LLMProvider = {
      respond: async () => ({ ...validOutput, answer: "д".repeat(200) }),
    };
    await expect(
      new ConformingLlmProvider(oversized, policy({ maxOutputTokens: 10 })).respond(input()),
    ).rejects.toMatchObject({ code: "LLM_OUTPUT_BUDGET_EXCEEDED" });
  });

  it("ограничивает частоту отдельно для каждого серверного субъекта", async () => {
    let calls = 0;
    const delegate: LLMProvider = {
      respond: async () => {
        calls += 1;
        return validOutput;
      },
    };
    const provider = new ConformingLlmProvider(
      delegate,
      policy({ requestsPerMinute: 1 }),
    );

    await provider.respond(input());
    await expect(provider.respond(input())).rejects.toMatchObject({
      code: "LLM_PROVIDER_RATE_LIMITED",
    });
    await provider.respond({ ...input(), userId: "other-user" });
    expect(calls).toBe(2);
  });
});

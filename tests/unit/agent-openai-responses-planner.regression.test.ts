import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { TrustedRequestContext } from "@/application/authorization-service";
import { MTR_AGENT_UNIVERSAL_VERSION } from "@/application/agent-orchestrator/system-prompt";
import { createUniversalReadCapabilityRegistry } from "@/application/agent-orchestrator/universal-chat/read-capabilities";
import { LiveUniversalChatService } from "@/application/agent-orchestrator/universal-chat/live-universal-chat-service";
import {
  OpenAIResponsesPlanner,
  parsePlannerCapabilityInput,
  readOpenAIResponsesPlannerConfig,
  type OpenAIResponsesClientLike,
} from "@/application/agent-orchestrator/universal-chat/live-planner";
import type { UniversalChatService } from "@/application/agent-orchestrator/universal-chat/universal-chat-service";
import { createAgentExecutionContext } from "@/domain/agent/context";
import type { UniversalAgentAnswer } from "@/domain/agent/universal-chat/answer";
import type { UniversalAgentReadPort } from "@/ports/universal-agent";

describe("official OpenAI Responses planner boundary", () => {
  it("uses streamed Responses API with store=false and a strict structured schema", async () => {
    const fake = responsesClient([{ decision: { kind: "CALL_CAPABILITIES", calls: [{
      capabilityKey: "project.list",
      argumentsJson: "{\"limit\":10}",
    }] } }]);
    const planner = new OpenAIResponsesPlanner(config(), fake.client);

    const planned = await planner.plan("Покажи проекты", context(), "system-v4");

    expect(planned.decision).toMatchObject({ kind: "CALL_CAPABILITIES" });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({
      model: "gpt-test-exact",
      store: false,
      max_output_tokens: 2_000,
      text: {
        format: expect.objectContaining({
          type: "json_schema",
          strict: true,
          name: "mtr_universal_planner_decision",
        }),
      },
    });
    expect(JSON.stringify(fake.requests[0])).not.toContain("server-secret-value");
    expect(planned.trace).toMatchObject({
      provider: "OPENAI",
      model: "gpt-test-exact",
      promptVersion: MTR_AGENT_UNIVERSAL_VERSION,
    });
  });

  it("validates every model-selected capability argument with the canonical strict schema", () => {
    expect(parsePlannerCapabilityInput({
      capabilityKey: "project.list",
      argumentsJson: "{\"limit\":10}",
    })).toEqual({ limit: 10 });
    expect(() => parsePlannerCapabilityInput({
      capabilityKey: "project.list",
      argumentsJson: "{\"limit\":10,\"subjectId\":\"forged\"}",
    })).toThrow();
    expect(() => parsePlannerCapabilityInput({
      capabilityKey: "project.list",
      argumentsJson: "not-json",
    })).toThrow();
  });

  it("uses live planning/composition without allowing the model to change public business truth", async () => {
    const fake = responsesClient([
      { decision: { kind: "CALL_CAPABILITIES", calls: [{
        capabilityKey: "project.list",
        argumentsJson: "{\"limit\":10}",
      }] } },
      {
        summary: "Проверенная формулировка live-модели",
        riskExplanations: [{ id: "risk-1", explanation: "Проверенный риск сформулирован яснее." }],
        recommendationExplanations: [{ id: "rec-1", explanation: "Проверенная рекомендация сформулирована яснее." }],
      },
    ]);
    const planner = new OpenAIResponsesPlanner(config(), fake.client);
    const registry = createUniversalReadCapabilityRegistry({
      listProjects: vi.fn(async () => []),
    } as unknown as UniversalAgentReadPort);
    const fallback = { respond: vi.fn(async () => deterministicAnswer()) } as unknown as UniversalChatService;
    const service = new LiveUniversalChatService(planner, registry, fallback, "system-v4");

    const result = await service.respond({ message: "Покажи проекты" }, context());

    expect(result).toMatchObject({
      summary: "Детерминированный вывод",
      facts: [{ key: "count", value: 22 }],
      risks: [{ id: "risk-1", level: "HIGH", explanation: "Исходное объяснение" }],
      recommendations: [{ id: "rec-1", quantity: 12, explanation: "Исходная рекомендация" }],
      citations: [{ sourceSystem: "SAP", entityId: "MAT-1" }],
      mode: "PRIMARY_LLM",
      runtime: { provider: "OPENAI", model: "gpt-test-exact" },
    });
  });

  it("returns the full deterministic answer when the provider is unavailable", async () => {
    const client = {
      responses: { stream: () => ({ finalResponse: async () => { throw { status: 503 }; } }) },
      models: { list: async () => ({ data: [] }) },
    } as OpenAIResponsesClientLike;
    const planner = new OpenAIResponsesPlanner({ ...config(), maxRetries: 1 }, client);
    const fallback = { respond: vi.fn(async () => deterministicAnswer()) } as unknown as UniversalChatService;
    const audit = { write: vi.fn(async () => undefined) };
    const service = new LiveUniversalChatService(
      planner,
      createUniversalReadCapabilityRegistry({} as UniversalAgentReadPort),
      fallback,
      "system-v4",
      audit,
    );

    const result = await service.respond({ message: "Покажи проекты" }, context());

    expect(result).toEqual(deterministicAnswer());
    expect(audit.write).toHaveBeenCalledWith(context(), expect.objectContaining({
      outcome: "FALLBACK",
      safeErrorCode: "OPENAI_PROVIDER_UNAVAILABLE",
    }));
  });

  it("stays fail-closed when the Preview secret or exact model is absent", () => {
    expect(readOpenAIResponsesPlannerConfig({})).toBeNull();
    expect(readOpenAIResponsesPlannerConfig({ OPENAI_API_KEY: "x" })).toBeNull();
    expect(readOpenAIResponsesPlannerConfig({ OPENAI_MODEL: "gpt-test" })).toBeNull();
  });
});

function config() {
  return {
    apiKey: "server-secret-value",
    model: "gpt-test-exact",
    providerVersion: "openai-node-test",
    promptVersion: MTR_AGENT_UNIVERSAL_VERSION,
    timeoutMs: 5_000,
    maxOutputTokens: 2_000,
    maxRetries: 0,
  };
}

function context() {
  const trusted: TrustedRequestContext = {
    subjectId: "demo-user-001",
    displayName: "Демо-пользователь 1",
    activeRoleAssignmentIds: ["assignment-1"],
    globalRoleKeys: [],
    activeProjectId: "demo-project-001",
    projectRoleKeys: ["PROJECT_MANAGER"],
    permissionKeys: new Set(["agent.chat", "project.read"]),
    catalogScopeIds: ["demo-catalog-001"],
    sourceScopeIds: ["demo-sap-001"],
    accessClaims: { warehouseIds: ["WH-DEMO-NORTH"] },
    authorizationVersion: 1,
    requestId: "request-openai-planner",
  };
  return createAgentExecutionContext(trusted);
}

function deterministicAnswer(): UniversalAgentAnswer {
  return {
    summary: "Детерминированный вывод",
    resolvedContext: {},
    facts: [{ key: "count", label: "Проектов", value: 22 }],
    tables: [],
    risks: [{ id: "risk-1", level: "HIGH", title: "Риск", explanation: "Исходное объяснение" }],
    compatibility: [],
    recommendations: [{
      id: "rec-1",
      kind: "REORDER",
      title: "Дозаказать",
      explanation: "Исходная рекомендация",
      quantity: 12,
      residualRisk: "Остаточный риск",
    }],
    actions: [],
    citations: [{
      sourceSystem: "SAP",
      entityId: "MAT-1",
      versionOrSnapshot: "snapshot-1",
      label: "Остаток",
      observedAt: "2026-08-13T09:15:00.000Z",
    }],
    missingData: [],
    confidence: 0.96,
    requiresHumanReview: true,
    generatedAt: "2026-08-13T09:15:00.000Z",
    mode: "DETERMINISTIC_FALLBACK",
  };
}

function responsesClient(outputs: readonly unknown[]) {
  const requests: Record<string, unknown>[] = [];
  let index = 0;
  const client: OpenAIResponsesClientLike = {
    responses: {
      stream: <T>(body: Record<string, unknown>) => {
        requests.push(body);
        const output = outputs[index] as T;
        index += 1;
        return {
          finalResponse: async () => ({
            id: `response-${index}`,
            model: "gpt-test-exact",
            output_parsed: output,
            usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
          }),
        };
      },
    },
    models: { list: async () => ({ data: [{ id: "gpt-test-exact" }] }) },
  };
  return { client, requests };
}

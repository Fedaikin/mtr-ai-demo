import {
  buildAgentObservability,
  buildAgentOperations,
  type AgentAuditEntry,
} from "@/application/agent-observability";
import type { IntegrationState, ScenarioRun } from "@/domain/models";

const baseEntry = {
  userId: "demo-user-001",
  actorDisplayName: "Демо-пользователь 1",
  entityType: "agent_tool_call",
  entityId: "integration-state",
  occurredAt: "2026-08-12T10:00:00.000Z",
} as const;

function entry(patch: Partial<AgentAuditEntry> & Pick<AgentAuditEntry, "id" | "action" | "outcome">): AgentAuditEntry {
  return {
    ...baseEntry,
    details: {},
    requestId: "agent-correlation-1",
    ...patch,
  };
}

describe("agent observability aggregation", () => {
  const entries: AgentAuditEntry[] = [
    entry({ id: "1", action: "agent.request.received", outcome: "SUCCESS" }),
    entry({
      id: "2",
      action: "agent.tool.result",
      outcome: "SUCCESS",
      details: {
        tool: "sap.getState",
        durationMs: 20,
        attempts: 1,
        conversationId: "thread-1",
        runId: "run-1",
        promptVersion: "v2",
        model: "Mock LLM",
        arguments: { password: "must-not-survive", entityId: "integration-state" },
        result: { state: "AVAILABLE" },
      },
    }),
    entry({
      id: "3",
      action: "agent.response.completed",
      outcome: "SUCCESS",
      occurredAt: "2026-08-12T10:00:01.000Z",
      details: { durationMs: 100, requiresHumanReview: true },
    }),
    entry({
      id: "4",
      action: "agent.request.received",
      outcome: "SUCCESS",
      requestId: "agent-correlation-2",
    }),
    entry({
      id: "5",
      action: "agent.tool.result",
      outcome: "FAILURE",
      requestId: "agent-correlation-2",
      occurredAt: "2026-08-12T10:01:00.000Z",
      details: { tool: "appius.getState", durationMs: 80, attempts: 2, errorCode: "APPIUS_UNAVAILABLE" },
    }),
    entry({
      id: "6",
      action: "agent.response.completed",
      outcome: "SUCCESS",
      requestId: "agent-correlation-2",
      occurredAt: "2026-08-12T10:01:01.000Z",
      details: { durationMs: 300, requiresHumanReview: false },
    }),
  ];

  it("computes request, latency, retry and review metrics", () => {
    const states = [
      { system: "SAP", state: "AVAILABLE", delayMs: 0 },
      { system: "APPIUS", state: "AVAILABLE", delayMs: 0 },
      { system: "LLM", state: "AVAILABLE", delayMs: 0 },
      { system: "RAG", state: "AVAILABLE", delayMs: 0 },
    ] as IntegrationState[];
    const runs = [{ status: "MATCHING_STOCK" }, { status: "COMPLETED" }] as ScenarioRun[];
    const metrics = buildAgentObservability(entries, states, runs);

    expect(metrics).toMatchObject({
      agentState: "PROCESSING",
      totalRequests: 2,
      successfulRequests: 1,
      failedRequests: 1,
      averageResponseMs: 200,
      p50ResponseMs: 100,
      p95ResponseMs: 300,
      toolCalls: 2,
      retries: 1,
      expertReviews: 1,
      activeScenarios: 1,
      lastFailureAt: "2026-08-12T10:01:00.000Z",
    });
  });

  it("keeps legacy uncorrelated request metrics internally consistent", () => {
    const legacyEntries = [
      entry({ id: "legacy-request", action: "agent.request.received", outcome: "SUCCESS", requestId: null }),
      entry({ id: "legacy-response", action: "agent.response.completed", outcome: "SUCCESS", requestId: null }),
    ];
    const metrics = buildAgentObservability(legacyEntries, [], []);

    expect(metrics).toMatchObject({
      totalRequests: 1,
      successfulRequests: 1,
      failedRequests: 0,
    });
  });

  it("builds sanitized operation cards and applies combined filters", () => {
    const operations = buildAgentOperations(entries, {
      user: "Демо",
      scenario: "run-1",
      tool: "sap",
      status: "SUCCESS",
      correlationId: "correlation-1",
      from: "2026-08-12",
      to: "2026-08-12",
    });

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      tool: "sap.getState",
      conversationId: "thread-1",
      runId: "run-1",
      durationMs: 20,
      status: "SUCCESS",
      attempts: 1,
      promptVersion: "v2",
      model: "Mock LLM",
    });
    expect(JSON.stringify(operations[0]?.arguments)).not.toContain("must-not-survive");
  });

  it("normalizes legacy undefined sentinels before admin presentation", () => {
    const operations = buildAgentOperations([
      entry({
        id: "legacy-undefined",
        action: "agent.tool.result",
        outcome: "SUCCESS",
        details: {
          tool: "sap.getState",
          runId: "undefined",
          result: { id: "undefined", state: "AVAILABLE", count: "null" },
        },
      }),
    ]);

    expect(operations[0]).toMatchObject({
      runId: null,
      result: { state: "AVAILABLE" },
    });
  });
});

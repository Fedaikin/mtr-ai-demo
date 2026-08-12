import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { getRepository, type MtrRepository } from "@/adapters/persistence/repository";
import { auditLogs } from "@/adapters/persistence/schema";
import { DEMO_USER_DISPLAY_NAME, DEMO_USER_ID } from "@/domain/models";

const TRACE_COUNT = 501;
const OLDEST_CORRELATION = "agent-correlation-oldest-beyond-500";

describe.sequential("agent observability repository", () => {
  let repository: MtrRepository;

  beforeEach(async () => {
    await resetDemoDatabase(DEMO_USER_ID);
    repository = await getRepository();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("filters before the page limit and aggregates the complete user-scoped log set", async () => {
    const database = await getDatabase();
    const rows = Array.from({ length: TRACE_COUNT }, (_, index) => {
      const correlationId = index === 0 ? OLDEST_CORRELATION : `agent-correlation-${index}`;
      const baseSecond = index * 3;
      const requestAt = timestamp(baseSecond);
      const toolAt = timestamp(baseSecond + 1);
      const responseAt = timestamp(baseSecond + 2);
      const common = {
        userId: DEMO_USER_ID,
        actorDisplayName: DEMO_USER_DISPLAY_NAME,
        entityType: "agent_tool_call",
        entityId: `material-${index}`,
        outcome: "SUCCESS",
        retentionUntil: "2028-01-01T00:00:00.000Z",
        requestId: correlationId,
      };
      return [
        {
          ...common,
          id: `scale-request-${index}`,
          action: "agent.request.received",
          occurredAt: requestAt,
          details: { correlationId, conversationId: `thread-${index}` },
        },
        {
          ...common,
          id: `scale-tool-${index}`,
          action: "agent.tool.result",
          outcome: index === 0 ? "FAILURE" : "SUCCESS",
          occurredAt: toolAt,
          details: {
            correlationId,
            conversationId: `thread-${index}`,
            runId: `run-${index}`,
            tool: "sap.getMaterialStock",
            durationMs: index + 1,
            attempts: index % 50 === 0 ? 2 : 1,
            result: { count: 1 },
            ...(index === 0 ? { errorCode: "SAP_UNAVAILABLE" } : {}),
          },
        },
        {
          ...common,
          id: `scale-response-${index}`,
          action: "agent.response.completed",
          occurredAt: responseAt,
          details: {
            correlationId,
            conversationId: `thread-${index}`,
            durationMs: index + 1,
            requiresHumanReview: index % 100 === 0,
          },
        },
      ];
    }).flat();
    await database.insert(auditLogs).values(rows);

    const newestPage = await repository.queryAgentAuditOperations(DEMO_USER_ID, { limit: 100 });
    expect(newestPage).toMatchObject({ total: TRACE_COUNT, limit: 100, offset: 0 });
    expect(newestPage.entries).toHaveLength(100);
    expect(newestPage.entries.some((entry) => entry.requestId === OLDEST_CORRELATION)).toBe(false);

    const oldCorrelationPage = await repository.queryAgentAuditOperations(DEMO_USER_ID, {
      correlationId: OLDEST_CORRELATION,
      tool: "getMaterialStock",
      scenario: "run-0",
      user: "Демо-пользователь 1",
      status: "FAILURE",
      errorType: "SAP_UNAVAILABLE",
      from: "2026-01-01",
      to: "2026-01-01",
      limit: 100,
    });
    expect(oldCorrelationPage).toMatchObject({ total: 1, limit: 100, offset: 0 });
    expect(oldCorrelationPage.entries).toEqual([
      expect.objectContaining({ id: "scale-tool-0", requestId: OLDEST_CORRELATION }),
    ]);

    await expect(repository.getAgentAuditMetrics(DEMO_USER_ID)).resolves.toEqual({
      totalRequests: TRACE_COUNT,
      successfulRequests: TRACE_COUNT - 1,
      failedRequests: 1,
      averageResponseMs: 251,
      p50ResponseMs: 251,
      p95ResponseMs: 476,
      toolCalls: TRACE_COUNT,
      retries: 11,
      expertReviews: 6,
      lastSuccessAt: timestamp((TRACE_COUNT - 1) * 3 + 2),
      lastFailureAt: timestamp(1),
    });
  });
});

function timestamp(seconds: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
}

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { getRepository } from "@/adapters/persistence/repository";
import { auditLogs } from "@/adapters/persistence/schema";
import { DEMO_USER_DISPLAY_NAME, DEMO_USER_ID } from "@/domain/models";

describe.sequential("ACC-AIUX-004: согласованность метрик сбоя", () => {
  beforeEach(async () => resetDemoDatabase(DEMO_USER_ID));
  afterAll(async () => closeDatabase());

  it("показывает timestamp для запроса без completed-response", async () => {
    const occurredAt = "2026-08-12T10:00:00.000Z";
    await (await getDatabase()).insert(auditLogs).values({
      id: "audit-incomplete-request",
      userId: DEMO_USER_ID,
      actorDisplayName: DEMO_USER_DISPLAY_NAME,
      action: "agent.request.received",
      entityType: "agent_thread",
      entityId: "thread-incomplete",
      outcome: "SUCCESS",
      details: { correlationId: "agent-incomplete" },
      requestId: "agent-incomplete",
      occurredAt,
      retentionUntil: "2027-08-12T10:00:00.000Z",
    });

    await expect((await getRepository()).getAgentAuditMetrics(DEMO_USER_ID)).resolves.toMatchObject({
      failedRequests: 1,
      lastFailureAt: occurredAt,
    });
  });

  it("выбирает самый поздний сбой между explicit failure и незавершённым запросом", async () => {
    const database = await getDatabase();
    await database.insert(auditLogs).values([
      {
        id: "audit-explicit-failure-older",
        userId: DEMO_USER_ID,
        actorDisplayName: DEMO_USER_DISPLAY_NAME,
        action: "agent.tool.result",
        entityType: "agent_thread",
        entityId: "thread-explicit-failure",
        outcome: "FAILURE",
        details: { correlationId: "agent-explicit-failure" },
        requestId: "agent-explicit-failure",
        occurredAt: "2026-08-12T09:00:00.000Z",
        retentionUntil: "2027-08-12T09:00:00.000Z",
      },
      {
        id: "audit-incomplete-request-newer",
        userId: DEMO_USER_ID,
        actorDisplayName: DEMO_USER_DISPLAY_NAME,
        action: "agent.request.received",
        entityType: "agent_thread",
        entityId: "thread-incomplete-newer",
        outcome: "SUCCESS",
        details: { correlationId: "agent-incomplete-newer" },
        requestId: "agent-incomplete-newer",
        occurredAt: "2026-08-12T11:00:00.000Z",
        retentionUntil: "2027-08-12T11:00:00.000Z",
      },
    ]);

    await expect((await getRepository()).getAgentAuditMetrics(DEMO_USER_ID)).resolves.toMatchObject({
      failedRequests: 1,
      lastFailureAt: "2026-08-12T11:00:00.000Z",
    });
  });
});

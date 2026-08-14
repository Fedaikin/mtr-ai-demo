import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PostgresAgentEventStore } from "@/adapters/persistence/agent-event-store";
import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase, getDatabase, type Database } from "@/adapters/persistence/db";
import { agentEventInbox, agentProactiveInsights, auditLogs } from "@/adapters/persistence/schema";
import {
  resolveAuthorizationContext,
  resolveServiceAuthorizationContext,
} from "@/application/authorization-service";
import { AgentEventService } from "@/application/agent-orchestrator/event-service";
import { MtrAgentOrchestrator } from "@/application/agent-orchestrator/orchestrator";
import { DEMO_USER_ID } from "@/domain/models";

vi.mock("server-only", () => ({}));

describe.sequential("durable EVENT channel оркестратора", () => {
  let db: Database;
  let store: PostgresAgentEventStore;
  let service: AgentEventService;

  beforeAll(async () => {
    await resetDemoDatabase(DEMO_USER_ID);
    db = await getDatabase();
    store = new PostgresAgentEventStore(db);
    service = new AgentEventService(store, () => new Date("2026-08-13T12:00:00.000Z"));
  });

  afterAll(async () => closeDatabase());

  it("идемпотентно принимает событие, создаёт один insight и проходит через общий runtime", async () => {
    const authorization = await resolveServiceAuthorizationContext(
      "demo-service-001",
      "demo-project-001",
    );
    const input = {
      sourceSystem: "SAP" as const,
      sourceEventId: "sap-snapshot-event-1",
      eventType: "SAP_SNAPSHOT_RECEIVED" as const,
      projectId: "demo-project-001",
      entityId: "snapshot-sap-2026-08-13",
      stateVersion: "snapshot-v1",
      occurredAt: "2026-08-13T11:55:00.000Z",
      payload: { token: "must-not-persist", safeReason: "Снимок принят" },
    };
    const event = await service.ingest(input, authorization);
    const sameEvent = await service.ingest(input, authorization);
    // A new service instance proves that no in-memory queue is required after
    // a serverless restart between ingress and processing.
    const restartedService = new AgentEventService(
      new PostgresAgentEventStore(db),
      () => new Date("2026-08-13T12:00:00.000Z"),
    );
    const orchestrator = new MtrAgentOrchestrator(
      { respond: vi.fn() },
      undefined,
      restartedService,
    );
    const request = {
      kind: "EVENT" as const,
      eventId: event.id,
      eventType: event.eventType,
      entityId: event.entityId,
      stateVersion: event.stateVersion,
      occurredAt: event.occurredAt,
      selection: { projectId: event.projectId },
      correlationId: event.correlationId,
    };
    const first = await orchestrator.handle(request, authorization);
    const replay = await orchestrator.handle(request, authorization);

    expect(sameEvent.id).toBe(event.id);
    expect(first).toMatchObject({
      kind: "EVENT",
      output: { title: "Получен новый снимок остатков", level: "LOW" },
    });
    expect(replay).toEqual(first);
    expect(Number((await db.select({ value: count() }).from(agentEventInbox))[0]?.value)).toBe(1);
    expect(Number((await db.select({ value: count() }).from(agentProactiveInsights))[0]?.value)).toBe(1);
    expect(JSON.stringify(await db.select().from(agentEventInbox))).not.toContain("must-not-persist");
    expect((await db.select().from(auditLogs).where(eq(auditLogs.entityId, event.id))).map((row) => row.action).sort()).toEqual([
      "agent.event.processed",
      "agent.event.received",
    ]);
  });

  it("новое состояние обновляет дедуплицированный insight и доступно человеку проекта", async () => {
    const serviceAuthorization = await resolveServiceAuthorizationContext(
      "demo-service-001",
      "demo-project-001",
    );
    const event = await service.ingest({
      sourceSystem: "SAP",
      sourceEventId: "sap-snapshot-event-2",
      eventType: "SAP_SNAPSHOT_RECEIVED",
      projectId: "demo-project-001",
      entityId: "snapshot-sap-2026-08-13",
      stateVersion: "snapshot-v2",
      occurredAt: "2026-08-13T12:00:00.000Z",
    }, serviceAuthorization);
    const orchestrator = new MtrAgentOrchestrator({ respond: vi.fn() }, undefined, service);
    await orchestrator.handle({
      kind: "EVENT",
      eventId: event.id,
      eventType: event.eventType,
      entityId: event.entityId,
      stateVersion: event.stateVersion,
      occurredAt: event.occurredAt,
      selection: { projectId: event.projectId },
    }, serviceAuthorization);

    const [insight] = await db.select().from(agentProactiveInsights);
    expect(insight).toMatchObject({ stateVersion: "snapshot-v2", version: 2 });
    const human = await resolveAuthorizationContext(DEMO_USER_ID, "demo-project-001");
    const visible = await service.listInsights(human);
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({ id: insight!.id, targetId: "snapshot-sap-2026-08-13" });
  });
});

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import type { TrustedRequestContext } from "@/application/authorization-service";

const session = vi.hoisted(() => ({ authorization: null as TrustedRequestContext | null }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({
  requirePermission: vi.fn(async () => ({
    user: { id: session.authorization!.subjectId, displayName: session.authorization!.displayName },
    authorization: session.authorization,
  })),
  SessionError: class SessionError extends Error {},
}));

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { seedIndustrialCatalogue } from "@/adapters/persistence/catalog-bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { getRepository } from "@/adapters/persistence/repository";
import { resolveAuthorizationContext } from "@/application/authorization-service";
import { seedUniversalChatDataset } from "@/adapters/persistence/universal-chat-bootstrap";
import { POST } from "@/app/api/agent/threads/[id]/messages/route";
import { createFixedScenarioClock } from "@/domain/agent/universal-chat/scenario-clock";
import { DEMO_USER_ID } from "@/domain/models";

const CLOCK = createFixedScenarioClock("2026-08-13T09:15:00.000Z");

describe.sequential("real chat HTTP route corrective path", () => {
  beforeAll(async () => {
    vi.stubEnv("MTR_AGENT_ORCHESTRATOR_ENABLED", "true");
    vi.stubEnv("MTR_AGENT_UNIVERSAL_CHAT_ENABLED", "true");
    vi.stubEnv("MTR_AGENT_LIVE_LLM_ENABLED", "false");
    session.authorization = managerContext();
    await closeDatabase();
    const database = await getDatabase({ migrations: "ensure" });
    await resetDemoDatabase(DEMO_USER_ID, database);
    await seedIndustrialCatalogue(DEMO_USER_ID, database);
    await seedUniversalChatDataset(DEMO_USER_ID, database, CLOCK);
  }, 90_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDatabase();
  });

  test("HTTP route → orchestrator → universal project capability → public persisted response", async () => {
    const repository = await getRepository();
    const thread = await repository.createAgentThread(DEMO_USER_ID, "Активные проекты");
    const response = await POST(request(thread.id, "Покажи активные проекты"), route(thread.id));
    const payload = await response.json() as { items: Array<{ structuredOutput?: Record<string, unknown> }> };
    const output = publicOutput(payload);

    expect(response.status).toBe(201);
    expect(output).toMatchObject({
      kind: "ANSWER",
      summary: "Доступно 22 активных бизнес-проекта.",
      confidence: 1,
      requiresHumanReview: false,
    });
    expect((output.tables as Array<{ rows: Array<Record<string, unknown>> }>)[0]?.rows).toHaveLength(22);
  });

  test("буквальный inventory input остаётся universal clarification через тот же HTTP route", async () => {
    const repository = await getRepository();
    const thread = await repository.createAgentThread(DEMO_USER_ID, "Проверка склада");
    const response = await POST(
      request(thread.id, "Есть ли на втором складке шкаф управления электродвигателем № 0001?"),
      route(thread.id),
    );
    const payload = await response.json() as { items: Array<{ structuredOutput?: Record<string, unknown> }> };

    expect(response.status).toBe(201);
    expect(publicOutput(payload)).toMatchObject({
      kind: "CLARIFICATION",
      candidates: [
        { kindLabel: "Склад", code: "WH-DEMO-CENTRAL" },
        { kindLabel: "Склад", code: "WH-DEMO-SOUTH" },
      ],
    });
  });

  test("manager, analyst и viewer получают один exact project corpus, service account fail-closed", async () => {
    const repository = await getRepository();
    const expectedIds = rows(await (await getDatabase()).execute(`
      select id from business_projects
      where tenant_id='demo-tenant-001'
        and access_project_id='demo-project-001'
        and status='ACTIVE'
      order by id
    `)).map((row) => String(row.id));

    for (const subjectId of [DEMO_USER_ID, "demo-analyst-001", "demo-viewer-001"]) {
      session.authorization = await resolveAuthorizationContext(subjectId, "demo-project-001");
      const thread = await repository.createAgentThread(subjectId, `Проекты ${subjectId}`);
      const response = await POST(request(thread.id, "Покажи активные проекты"), route(thread.id));
      const payload = await response.json() as { items: Array<{ structuredOutput?: Record<string, unknown> }> };
      const output = publicOutput(payload);
      const persisted = await repository.listAgentMessages(subjectId, thread.id);
      const actualIds = persisted.at(-1)?.citations.map((item) => item.entityId).sort();
      expect(response.status).toBe(201);
      expect(actualIds).toEqual(expectedIds);
      expect((output.tables as Array<{ totalRows: number }>)[0]?.totalRows).toBe(expectedIds.length);
    }

    session.authorization = serviceContext();
    const serviceThread = await repository.createAgentThread("demo-service-001", "Запрещённый interactive chat");
    const denied = await POST(request(serviceThread.id, "Покажи активные проекты"), route(serviceThread.id));
    expect(denied.status).toBe(403);
    expect(JSON.stringify(await denied.json())).not.toMatch(/project-project-mtr|Проект модернизации/iu);
  });

  test("stock HTTP path сохраняется у analyst и не раскрывает объект viewer/service", async () => {
    const repository = await getRepository();
    session.authorization = await resolveAuthorizationContext("demo-analyst-001", "demo-project-001");
    const analystThread = await repository.createAgentThread("demo-analyst-001", "Остаток аналитика");
    const allowed = await POST(request(
      analystThread.id,
      "Есть ли на WH-DEMO-CENTRAL шкаф управления электродвигателем № 0001?",
    ), route(analystThread.id));
    expect(allowed.status).toBe(201);
    expect(publicOutput(await allowed.json())).toMatchObject({ kind: "ANSWER" });
    const analystMessages = await repository.listAgentMessages("demo-analyst-001", analystThread.id);
    expect(analystMessages.at(-1)?.citations).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: "SAP-CATALOG-ASM-ELC-0001" }),
    ]));

    for (const subjectId of ["demo-viewer-001", "demo-service-001"]) {
      session.authorization = subjectId === "demo-service-001"
        ? serviceContext()
        : await resolveAuthorizationContext(subjectId, "demo-project-001");
      const thread = await repository.createAgentThread(subjectId, `Запрещённый остаток ${subjectId}`);
      const denied = await POST(request(
        thread.id,
        "Есть ли на WH-DEMO-CENTRAL шкаф управления электродвигателем № 0001?",
      ), route(thread.id));
      expect(denied.status).toBe(403);
      expect(JSON.stringify(await denied.json())).not.toMatch(/SAP-CATALOG|WH-DEMO-CENTRAL|Шкаф управления/iu);
    }
  });
});

function managerContext(): TrustedRequestContext {
  return {
    subjectId: DEMO_USER_ID,
    displayName: "Демо-пользователь 1",
    activeRoleAssignmentIds: ["assign-demo-manager"],
    globalRoleKeys: ["SYSTEM_ADMIN"],
    activeProjectId: "demo-project-001",
    projectRoleKeys: ["PROJECT_MANAGER"],
    permissionKeys: new Set([
      "agent.chat", "project.read", "specification.read", "specification.history.read",
      "catalog.read", "catalog.substitutes.read", "catalog.bom.read", "stock.search",
      "analysis.read", "analysis.create", "review.read", "review.queue.read",
    ]),
    catalogScopeIds: ["demo-catalog-001"],
    sourceScopeIds: ["demo-sap-001", "demo-normative-001", "demo-system-config-001"],
    accessClaims: { warehouseIds: [
      "WH-DEMO-NORTH", "WH-DEMO-CENTRAL", "WH-DEMO-ELECTRICAL", "WH-DEMO-SOUTH",
      "WH-DEMO-INSTRUMENT", "WH-DEMO-EQUIPMENT", "WH-DEMO-RESERVE",
    ] },
    authorizationVersion: 1,
    requestId: "request-http-remediation",
  };
}

function serviceContext(): TrustedRequestContext {
  return {
    subjectId: "demo-service-001",
    displayName: "Интеграционная служба",
    activeRoleAssignmentIds: ["assign-service"],
    globalRoleKeys: ["INTEGRATION_SERVICE"],
    activeProjectId: "demo-project-001",
    projectRoleKeys: [],
    permissionKeys: new Set(["source.appius.read", "source.sap.read", "source.rag.read", "sink.siem.write"]),
    catalogScopeIds: [],
    sourceScopeIds: ["demo-sap-001", "demo-normative-001", "demo-system-config-001"],
    accessClaims: {},
    authorizationVersion: 1,
    requestId: "request-service-http-remediation",
  };
}

function rows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) {
    return result.rows as Array<Record<string, unknown>>;
  }
  return [];
}

function request(threadId: string, message: string) {
  return new Request(`http://localhost/api/agent/threads/${threadId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ threadId, message, selection: { projectId: "demo-project-001" } }),
  });
}

function route(id: string) {
  return { params: Promise.resolve({ id }) };
}

function publicOutput(payload: { items: Array<{ structuredOutput?: Record<string, unknown> }> }) {
  const structured = payload.items.at(-1)?.structuredOutput;
  if (!structured || structured.schemaVersion !== "universal-agent-answer-public-v1") {
    throw new Error("Universal structured output отсутствует.");
  }
  return structured;
}

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

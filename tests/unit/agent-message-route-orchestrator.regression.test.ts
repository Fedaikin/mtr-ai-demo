import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TrustedRequestContext } from "@/application/authorization-service";

const mocks = vi.hoisted(() => ({
  authorization: null as TrustedRequestContext | null,
  handle: vi.fn(),
  listAgentThreads: vi.fn(),
  appendAgentMessage: vi.fn(),
  getActivePrompt: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/adapters/persistence/repository", () => ({
  getRepository: vi.fn(async () => ({
    listAgentThreads: mocks.listAgentThreads,
    appendAgentMessage: mocks.appendAgentMessage,
    getActivePrompt: mocks.getActivePrompt,
  })),
}));
vi.mock("@/lib/session", () => ({
  requirePermission: vi.fn(async () => ({
    user: { id: "legacy-user-id" },
    authorization: mocks.authorization,
  })),
  SessionError: class SessionError extends Error {},
}));
vi.mock("@/app/api/agent/_shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/api/agent/_shared")>();
  return {
    ...actual,
    createMtrAgentOrchestrator: vi.fn(() => ({ handle: mocks.handle })),
  };
});

import { POST } from "@/app/api/agent/threads/[id]/messages/route";

describe("agent messages route canonical context handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorization = trustedContext();
    mocks.listAgentThreads.mockResolvedValue([{ id: "thread-1" }]);
    mocks.getActivePrompt.mockResolvedValue({ promptVersion: "prompt-v2" });
    mocks.appendAgentMessage
      .mockResolvedValueOnce(messageBundle("user-message", "user", "Покажи остатки"))
      .mockResolvedValueOnce(messageBundle("assistant-message", "assistant", "Подтверждено"));
    mocks.handle.mockResolvedValue({
      kind: "CHAT",
      output: {
        answer: "Подтверждено",
        facts: [],
        recommendations: [],
        citations: [],
        confidence: 1,
        requiresHumanReview: false,
        toolCalls: [],
      },
    });
  });

  it("передаёт полный session.authorization и не конструирует identity из body", async () => {
    const response = await POST(
      jsonRequest({
        message: "Покажи остатки",
        threadId: "thread-1",
        selection: { projectId: "project-1", positionId: "position-1" },
      }),
      routeContext("thread-1"),
    );

    expect(response.status).toBe(201);
    expect(mocks.handle).toHaveBeenCalledWith(
      {
        kind: "CHAT",
        message: "Покажи остатки",
        threadId: "thread-1",
        selection: { projectId: "project-1", positionId: "position-1" },
        correlationId: expect.stringMatching(/^agent-/),
        promptVersion: "prompt-v2",
      },
      mocks.authorization,
    );
    expect(mocks.listAgentThreads).toHaveBeenCalledWith("subject-1");
    expect(mocks.appendAgentMessage).toHaveBeenCalledWith(
      "subject-1",
      expect.objectContaining({ role: "user" }),
    );
  });

  it("отклоняет поддельную identity до orchestrator", async () => {
    const response = await POST(
      jsonRequest({
        message: "Покажи остатки",
        threadId: "thread-1",
        selection: { projectId: "project-1" },
        userId: "foreign-user",
      }),
      routeContext("thread-1"),
    );

    expect(response.status).toBe(400);
    expect(mocks.handle).not.toHaveBeenCalled();
  });

  it("сохраняет естественную typed command как безопасный ответ того же диалога", async () => {
    mocks.handle.mockResolvedValue({
      kind: "COMMAND",
      output: {
        responseType: "KPI",
        title: "KPI и SLA",
        summary: "Доступны четыре подтверждённых показателя.",
        metrics: [],
        citations: [{
          sourceKind: "PROCESS_EVENT",
          sourceSystem: "PROCESS_ENGINE",
          entityId: "event-1",
          sourceSnapshot: "process-v1",
          observedAt: "2026-08-13T00:00:00.000Z",
        }],
        missingData: [],
        confidence: 0.9,
        requiresHumanReview: false,
        negativeEvidence: "NOT_EMPTY",
        generatedAt: "2026-08-13T10:00:00.000Z",
      },
    });

    const response = await POST(
      jsonRequest({
        message: "Покажи KPI и SLA",
        threadId: "thread-1",
        selection: { projectId: "project-1" },
      }),
      routeContext("thread-1"),
    );

    expect(response.status).toBe(201);
    expect(mocks.appendAgentMessage).toHaveBeenLastCalledWith(
      "subject-1",
      expect.objectContaining({
        role: "assistant",
        content: "Доступны четыре подтверждённых показателя.",
        structuredOutput: expect.objectContaining({
          schemaVersion: "mtr-agent-command-public-v1",
          responseLabel: "KPI и SLA",
          technicalContentRemoved: false,
        }),
        citations: [{
          sourceSystem: "PROCESS_ENGINE",
          entityId: "event-1",
          versionOrSnapshot: "process-v1",
          clauseId: null,
        }],
      }),
    );
  });
});

function trustedContext(): TrustedRequestContext {
  return {
    subjectId: "subject-1",
    displayName: "Тестовый пользователь",
    activeRoleAssignmentIds: ["assignment-1"],
    globalRoleKeys: [],
    activeProjectId: "project-1",
    projectRoleKeys: ["PROJECT_VIEWER"],
    permissionKeys: new Set(["agent.chat"]),
    catalogScopeIds: ["catalog-1"],
    sourceScopeIds: ["source-1"],
    accessClaims: { warehouseIds: ["warehouse-1"] },
    authorizationVersion: 7,
    requestId: "request-1",
  };
}

function messageBundle(id: string, role: "user" | "assistant", content: string) {
  return {
    message: {
      id,
      threadId: "thread-1",
      userId: "subject-1",
      role,
      content,
      structuredOutput: null,
      promptVersion: null,
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
      createdBy: "subject-1",
      version: 1,
    },
    citations: [],
  };
}

function jsonRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/agent/threads/thread-1/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

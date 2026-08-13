import type { TrustedRequestContext } from "@/application/authorization-service";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/adapters/persistence/agent-learning-store", () => ({
  createAgentLearningStore: vi.fn(async () => ({ name: "store" })),
}));
vi.mock("@/application/agent-orchestrator/learning-service", async () => {
  const actual = await vi.importActual<typeof import("@/application/agent-orchestrator/learning-service")>(
    "@/application/agent-orchestrator/learning-service",
  );
  return {
    ...actual,
    AgentFeedbackService: class AgentFeedbackService {
      submit = mocks.submit;
    },
  };
});
vi.mock("@/lib/session", () => ({
  requirePermission: vi.fn(async () => ({ authorization: trusted() })),
  SessionError: class SessionError extends Error {},
}));

import { POST } from "@/app/api/agent/messages/[id]/feedback/route";

describe("agent feedback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.submit.mockResolvedValue({
      candidateId: "learning-1",
      feedbackKind: "USEFUL",
      status: "QUARANTINED",
      message: "Отзыв сохранён для проверки специалистом и не изменяет работу агента автоматически.",
    });
  });

  it("accepts a closed feedback kind and passes only canonical session context", async () => {
    const response = await POST(new Request("http://localhost/api/agent/messages/message-1/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feedbackKind: "USEFUL", userId: "foreign" }),
    }), { params: Promise.resolve({ id: "message-1" }) });

    expect(response.status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled();

    const accepted = await POST(new Request("http://localhost/api/agent/messages/message-1/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feedbackKind: "USEFUL" }),
    }), { params: Promise.resolve({ id: "message-1" }) });

    expect(accepted.status).toBe(201);
    expect(accepted.headers.get("cache-control")).toContain("private");
    expect(mocks.submit).toHaveBeenCalledWith(
      { responseMessageId: "message-1", feedbackKind: "USEFUL" },
      expect.objectContaining({ subjectId: "demo-user-001", activeProjectId: "demo-project-001" }),
    );
  });
});

function trusted(): TrustedRequestContext {
  return {
    subjectId: "demo-user-001",
    displayName: "Аналитик",
    activeRoleAssignmentIds: ["assignment-demo"],
    globalRoleKeys: [],
    activeProjectId: "demo-project-001",
    projectRoleKeys: ["PROJECT_MANAGER"],
    permissionKeys: new Set(["agent.chat"]),
    catalogScopeIds: ["demo-catalog-001"],
    sourceScopeIds: ["demo-sap-001"],
    accessClaims: {},
    authorizationVersion: 1,
    requestId: "request-feedback-route",
  };
}

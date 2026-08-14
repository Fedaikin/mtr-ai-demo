import type { TrustedRequestContext } from "@/application/authorization-service";
import type { AgentFeaturePolicy } from "@/application/agent-orchestrator/feature-policy";

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  writeAudit: vi.fn(),
  policy: {
    orchestratorEnabled: true,
    actionsEnabled: false,
    eventsEnabled: false,
    executionAllowed: true,
  } as AgentFeaturePolicy,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/adapters/persistence/repository", () => ({
  getRepository: vi.fn(async () => ({ writeAudit: mocks.writeAudit })),
}));
vi.mock("@/lib/session", () => ({
  requirePermission: vi.fn(async () => ({
    user: { id: "legacy-user-id" },
    authorization: trustedContext(),
  })),
  SessionError: class SessionError extends Error {},
}));
vi.mock("@/application/agent-orchestrator/feature-policy", () => ({
  readAgentFeaturePolicy: vi.fn(() => mocks.policy),
}));
vi.mock("@/app/api/agent/_shared", () => ({
  createMtrAgentOrchestrator: vi.fn(() => ({ handle: mocks.handle })),
}));

import { POST } from "@/app/api/agent/commands/[commandKey]/route";

describe("command route projection and feature gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.policy = {
      orchestratorEnabled: true,
      actionsEnabled: false,
      eventsEnabled: false,
      executionAllowed: true,
    };
    mocks.writeAudit.mockResolvedValue({ id: "audit-1" });
    mocks.handle.mockResolvedValue({
      kind: "COMMAND",
      output: {
        responseType: "STOCKS",
        title: "Остатки",
        summary: "Найдена одна строка.",
        items: [],
        citations: [],
        missingData: [],
        confidence: 0.7,
        requiresHumanReview: true,
        negativeEvidence: "NOT_EMPTY",
        generatedAt: "2026-08-13T10:00:00.000Z",
      },
    });
  });

  it("передаёт typed request в общий orchestrator и возвращает public projection", async () => {
    const response = await POST(
      jsonRequest({
        context: { projectId: "project-1" },
        filters: {
          query: "закрытое название детали",
          warehouseIds: ["WH-01", "WH-02"],
        },
      }),
      routeContext("STOCKS"),
    );

    expect(response.status).toBe(200);
    await expect(response.clone().json()).resolves.toEqual({
      result: expect.objectContaining({
        schemaVersion: "mtr-agent-command-public-v1",
        responseLabel: "Остатки",
        answer: "Найдена одна строка.",
        technicalContentRemoved: false,
      }),
    });
    expect(mocks.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "COMMAND",
        commandKey: "STOCKS",
        selection: { projectId: "project-1" },
        filters: {
          query: "закрытое название детали",
          warehouseIds: ["WH-01", "WH-02"],
        },
        correlationId: expect.stringMatching(/^agent-command-/),
      }),
      expect.objectContaining({ subjectId: "subject-1", authorizationVersion: 7 }),
    );

    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("возвращает безопасную ошибку capability без route-level side effects", async () => {
    mocks.handle.mockRejectedValue(Object.assign(new Error("закрытая причина"), { code: "SOURCE_DOWN" }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(
      jsonRequest({ context: { projectId: "project-1" }, filters: { levels: ["HIGH"] } }),
      routeContext("RISKS"),
    );

    expect(response.status).toBe(500);
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("не дублирует аудит, который принадлежит общей command capability", async () => {

    const response = await POST(
      jsonRequest({ context: { projectId: "project-1" } }),
      routeContext("SUMMARY"),
    );

    expect(response.status).toBe(200);
    expect(mocks.handle).toHaveBeenCalledOnce();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("возвращает 404 при выключенном orchestrator flag", async () => {
    mocks.policy = { ...mocks.policy, orchestratorEnabled: false, executionAllowed: false };

    const response = await POST(
      jsonRequest({ context: { projectId: "project-1" } }),
      routeContext("SUMMARY"),
    );

    expect(response.status).toBe(404);
    expect(mocks.handle).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("возвращает 503 при активном kill switch", async () => {
    mocks.policy = { ...mocks.policy, orchestratorEnabled: true, executionAllowed: false };

    const response = await POST(
      jsonRequest({ context: { projectId: "project-1" } }),
      routeContext("SUMMARY"),
    );

    expect(response.status).toBe(503);
    expect(mocks.handle).not.toHaveBeenCalled();
  });
});

function trustedContext(): TrustedRequestContext {
  return {
    subjectId: "subject-1",
    displayName: "Аналитик",
    activeRoleAssignmentIds: ["assignment-1"],
    globalRoleKeys: [],
    activeProjectId: "project-1",
    projectRoleKeys: ["MTR_ANALYST"],
    permissionKeys: new Set(["agent.chat", "stock.search", "analysis.read", "project.read"]),
    catalogScopeIds: ["catalog-1"],
    sourceScopeIds: ["sap-1"],
    accessClaims: { warehouseIds: ["WH-01", "WH-02"] },
    authorizationVersion: 7,
    requestId: "request-1",
  };
}

function jsonRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/agent/commands/STOCKS", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routeContext(commandKey: string) {
  return { params: Promise.resolve({ commandKey }) };
}

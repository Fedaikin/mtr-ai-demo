import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearAnalysisView: vi.fn(),
  requirePermission: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/adapters/persistence/repository", () => ({
  getRepository: vi.fn(async () => ({ clearAnalysisView: mocks.clearAnalysisView })),
}));
vi.mock("@/lib/session", () => ({
  requirePermission: mocks.requirePermission,
  SessionError: class SessionError extends Error {},
}));

import { POST } from "@/app/api/mtr-analysis/clear/route";

describe("MTR analysis clear route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue({
      user: { id: "demo-user-001", displayName: "Демо-пользователь 1" },
      authorization: {
        activeProjectId: "demo-project-001",
        authorizationVersion: 7,
        requestId: "request-clear-1",
      },
    });
    mocks.clearAnalysisView.mockResolvedValue({
      runId: "run-1",
      clearedAt: "2026-08-15T12:00:00.000Z",
    });
  });

  it("authorizes the mutation and scopes it to the trusted session user", async () => {
    const response = await POST(request({ runId: "run-1" }));

    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith("analysis.create");
    expect(mocks.clearAnalysisView).toHaveBeenCalledWith(
      "demo-user-001",
      "demo-project-001",
      "run-1",
      "Демо-пользователь 1",
      7,
      "request-clear-1",
    );
  });

  it("rejects a cross-origin request before executing the mutation", async () => {
    const response = await POST(request(
      { runId: "run-1" },
      { origin: "https://attacker.example", host: "mtr.example" },
    ));

    expect(response.status).toBe(403);
    expect(mocks.clearAnalysisView).not.toHaveBeenCalled();
  });

  it("returns 404 when the completed run is outside the trusted scope", async () => {
    mocks.clearAnalysisView.mockResolvedValue(null);
    const response = await POST(request({ runId: "foreign-run" }));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "COMPLETED_ANALYSIS_NOT_FOUND" },
    });
  });

  it("fails closed when the trusted session has no active project", async () => {
    mocks.requirePermission.mockResolvedValue({
      user: { id: "demo-user-001", displayName: "Демо-пользователь 1" },
      authorization: {
        activeProjectId: null,
        authorizationVersion: 7,
        requestId: "request-clear-no-project",
      },
    });

    const response = await POST(request({ runId: "run-1" }));

    expect(response.status).toBe(403);
    expect(mocks.clearAnalysisView).not.toHaveBeenCalled();
  });
});

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("https://mtr.example/api/mtr-analysis/clear", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

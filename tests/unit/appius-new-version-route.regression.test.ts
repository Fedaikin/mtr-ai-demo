import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processNewVersionEvent: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({
  requireDemoRole: vi.fn(async () => ({ user: { id: "demo-user-001" } })),
  SessionError: class SessionError extends Error {},
}));
vi.mock("@/adapters/mock/appius-adapter", () => ({
  AppiusMockError: class AppiusMockError extends Error {},
  createAppiusMockAdapter: vi.fn(async () => ({
    processNewVersionEvent: mocks.processNewVersionEvent,
  })),
}));

import { POST as processNewVersionEvent } from "@/app/api/mock/appius/events/new-version/route";

describe("Appius new-version event HTTP validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a whitespace-only eventId with the stable validation code", async () => {
    const response = await processNewVersionEvent(jsonRequest({ eventId: "   " }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "Проверьте переданные данные",
      },
    });
    expect(mocks.processNewVersionEvent).not.toHaveBeenCalled();
  });

  it("normalizes surrounding whitespace before forwarding a valid eventId", async () => {
    mocks.processNewVersionEvent.mockResolvedValue({
      eventType: "APPIUS_NEW_VERSION",
      specificationId: "spec-demo-piping-001",
      previousVersionId: "spec-demo-piping-001-v3",
      currentVersionId: "spec-demo-piping-001-v4",
      usedVersionId: "spec-demo-piping-001-v4",
      rejectedVersionId: null,
      auditCode: "NEW_VERSION_PROMOTED",
    });

    const response = await processNewVersionEvent(jsonRequest({
      eventId: "  appius-event:v3-to-v4  ",
      specificationId: "spec-demo-piping-001",
      currentVersionId: "spec-demo-piping-001-v3",
    }));

    expect(response.status).toBe(200);
    expect(mocks.processNewVersionEvent).toHaveBeenCalledWith({
      eventId: "appius-event:v3-to-v4",
      specificationId: "spec-demo-piping-001",
      currentVersionId: "spec-demo-piping-001-v3",
    }, "demo-user-001");
  });
});

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/mock/appius/events/new-version", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

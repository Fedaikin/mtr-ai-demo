import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { assertEventIngress } from "@/app/api/agent/events/_shared";

const SECRET = "event-ingress-secret-with-at-least-32-characters";
const saved = { ...process.env };

describe("service-only event ingress", () => {
  beforeEach(() => {
    process.env.MTR_AGENT_ORCHESTRATOR_ENABLED = "true";
    process.env.MTR_AGENT_EVENTS_ENABLED = "true";
    process.env.MTR_AGENT_KILL_SWITCH = "false";
    process.env.MTR_AGENT_EVENT_INGRESS_SECRET = SECRET;
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  });

  it.each([undefined, "wrong", `${SECRET}x`])("отклоняет отсутствующий или неверный secret", (secret) => {
    const headers = secret ? { "x-mtr-event-secret": secret } : undefined;
    expect(() => assertEventIngress(new Request("http://localhost/api/agent/events", { method: "POST", headers })))
      .toThrow(expect.objectContaining({ status: 401, code: "AGENT_EVENT_INGRESS_UNAUTHORIZED" }));
  });

  it("принимает exact secret и fail-closed с kill switch", () => {
    const request = new Request("http://localhost/api/agent/events", {
      method: "POST",
      headers: { "x-mtr-event-secret": SECRET },
    });
    expect(() => assertEventIngress(request)).not.toThrow();
    process.env.MTR_AGENT_KILL_SWITCH = "true";
    expect(() => assertEventIngress(request)).toThrow(expect.objectContaining({ status: 503 }));
  });
});

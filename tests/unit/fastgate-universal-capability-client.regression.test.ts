import { describe, expect, it, vi } from "vitest";

import { createFastGateUniversalCapabilityClient } from "@/adapters/fastgate/fastgate-universal-capability-client";
import type { TrustedRequestContext } from "@/application/authorization-service";
import { createAgentExecutionContext } from "@/domain/agent/context";

describe("official FastGate universal capability client", () => {
  it("передаёт witness только проверенный capability input и минимальную server identity", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ output: [{ id: "project-1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const client = createFastGateUniversalCapabilityClient({
      FASTGATE_OFFICIAL: "1",
      FASTGATE_WITNESS_URL: "http://http-proxy:4310/__fastgate/witness",
    }, fetchImpl);
    const context = createAgentExecutionContext(trusted());

    await expect(client.execute("project.list", context, { limit: 7 })).resolves.toEqual([
      { id: "project-1" },
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://http-proxy:4310/__fastgate/witness/v1/capability");
    expect(init).toMatchObject({ method: "POST", cache: "no-store" });
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(payload).toEqual({
      capabilityKey: "project.list",
      input: { limit: 7 },
      context: {
        subjectId: "demo-user-001",
        activeProjectId: "demo-project-001",
        authorizationVersion: 7,
        correlationId: "correlation-fastgate-unit",
      },
    });
    expect(JSON.stringify(payload)).not.toMatch(/permission|role|claim|password|secret/iu);
  });

  it("fail-closed отклоняет запуск вне official mode и любой URL кроме внутреннего witness", () => {
    expect(() => createFastGateUniversalCapabilityClient({
      FASTGATE_OFFICIAL: "0",
      FASTGATE_WITNESS_URL: "http://http-proxy:4310/__fastgate/witness",
    })).toThrow("FASTGATE_WITNESS_CLIENT_DISABLED");
    expect(() => createFastGateUniversalCapabilityClient({
      FASTGATE_OFFICIAL: "1",
      FASTGATE_WITNESS_URL: "http://127.0.0.1:4320",
    })).toThrow("FASTGATE_WITNESS_URL_FORBIDDEN");
    expect(() => createFastGateUniversalCapabilityClient({
      FASTGATE_OFFICIAL: "1",
      FASTGATE_WITNESS_URL: "http://connector-witness:4320",
    })).toThrow("FASTGATE_WITNESS_URL_FORBIDDEN");
    expect(() => createFastGateUniversalCapabilityClient({
      FASTGATE_OFFICIAL: "1",
      FASTGATE_WITNESS_URL: "http://http-proxy:4310/__fastgate/witness?token=leak",
    })).toThrow("FASTGATE_WITNESS_URL_FORBIDDEN");
  });

  it("не принимает ошибку, не-JSON и слишком большой ответ witness как capability result", async () => {
    const clientFor = (response: Response) => createFastGateUniversalCapabilityClient({
      FASTGATE_OFFICIAL: "1",
      FASTGATE_WITNESS_URL: "http://http-proxy:4310/__fastgate/witness",
    }, vi.fn(async () => response));
    const context = createAgentExecutionContext(trusted());

    await expect(clientFor(new Response("denied", { status: 403 })).execute(
      "project.list",
      context,
      {},
    )).rejects.toThrow("FASTGATE_WITNESS_REQUEST_FAILED");
    await expect(clientFor(new Response("not-json", { status: 200 })).execute(
      "project.list",
      context,
      {},
    )).rejects.toThrow("FASTGATE_WITNESS_RESPONSE_INVALID");
    await expect(clientFor(new Response(JSON.stringify({ output: "x".repeat(5_000_001) }), { status: 200 })).execute(
      "project.list",
      context,
      {},
    )).rejects.toThrow("FASTGATE_WITNESS_RESPONSE_TOO_LARGE");
  });
});

function trusted(): TrustedRequestContext {
  return {
    subjectId: "demo-user-001",
    displayName: "Аналитик МТР",
    activeRoleAssignmentIds: ["assignment-1"],
    globalRoleKeys: [],
    activeProjectId: "demo-project-001",
    projectRoleKeys: ["MTR_ANALYST"],
    permissionKeys: new Set(["agent.chat", "project.read"]),
    catalogScopeIds: ["demo-catalog-001"],
    sourceScopeIds: ["demo-sap-001"],
    accessClaims: { warehouseIds: ["WH-DEMO-NORTH"] },
    authorizationVersion: 7,
    requestId: "correlation-fastgate-unit",
  };
}

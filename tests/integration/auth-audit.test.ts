import { afterAll, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase } from "@/adapters/persistence/db";
import { getRepository } from "@/adapters/persistence/repository";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { DEMO_USER_DISPLAY_NAME, DEMO_USER_ID } from "@/domain/models";
import { SESSION_COOKIE_NAME } from "@/lib/auth-config";

describe.sequential("authentication audit", () => {
  beforeEach(async () => {
    await resetDemoDatabase(DEMO_USER_ID);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("records correlated login success, login failure and logout without credentials", async () => {
    const invalidPassword = "wrong-password-audit-proof";
    const failed = await login(
      jsonRequest(
        { login: "demo", password: invalidPassword },
        { "x-request-id": invalidPassword },
      ),
    );
    expect(failed.status).toBe(401);

    const succeeded = await login(
      jsonRequest(
        { login: "demo", password: "Demo2026!" },
        { "x-request-id": "caller-controlled-success" },
      ),
    );
    expect(succeeded.status).toBe(200);
    const cookie = succeeded.headers.get("set-cookie") ?? "";
    const token = cookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`))?.[1];
    expect(token).toBeTruthy();

    const loggedOut = await logout(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${token}`,
          host: "localhost",
          "x-request-id": token ?? "missing-token",
        },
      }),
    );
    expect(loggedOut.status).toBe(204);

    const repository = await getRepository();
    const [loginFailure] = await repository.listAuditLogs(DEMO_USER_ID, {
      action: "AUTH_LOGIN_FAILED",
      limit: 1,
    });
    const [loginSuccess] = await repository.listAuditLogs(DEMO_USER_ID, {
      action: "AUTH_LOGIN_SUCCEEDED",
      limit: 1,
    });
    const [logoutSuccess] = await repository.listAuditLogs(DEMO_USER_ID, {
      action: "AUTH_LOGOUT_SUCCEEDED",
      limit: 1,
    });

    expect(loginFailure).toMatchObject({
      actorDisplayName: DEMO_USER_DISPLAY_NAME,
      entityType: "AUTHENTICATION",
      outcome: "FAILURE",
      details: {
        errorCode: "INVALID_CREDENTIALS",
      },
    });
    expect(loginSuccess).toMatchObject({
      actorDisplayName: DEMO_USER_DISPLAY_NAME,
      entityType: "AUTH_SESSION",
      outcome: "SUCCESS",
      details: {
        authenticationMethod: "DEMO_CREDENTIALS",
      },
    });
    expect(logoutSuccess).toMatchObject({
      actorDisplayName: DEMO_USER_DISPLAY_NAME,
      entityType: "AUTH_SESSION",
      outcome: "SUCCESS",
      details: {
        sessionRevoked: true,
      },
    });

    for (const event of [loginFailure, loginSuccess, logoutSuccess]) {
      expect(event?.requestId).toMatch(/^request-[0-9a-f-]{36}$/u);
      expect(event?.details).toMatchObject({ correlationId: event?.requestId });
    }

    const serialized = JSON.stringify([loginFailure, loginSuccess, logoutSuccess]);
    expect(serialized).not.toContain(invalidPassword);
    expect(serialized).not.toContain("Demo2026!");
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain("caller-controlled-success");
  });
});

function jsonRequest(
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "localhost",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

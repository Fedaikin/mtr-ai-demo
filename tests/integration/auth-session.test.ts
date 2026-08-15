vi.mock("server-only", () => ({}));

import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";

import { AppiusMockAdapter } from "@/adapters/mock/appius-adapter";
import {
  initializeDatabase,
  resetDemoDatabase,
} from "@/adapters/persistence/bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { getRepository } from "@/adapters/persistence/repository";
import { authSessions, users } from "@/adapters/persistence/schema";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as switchRole } from "@/app/api/auth/switch-role/route";
import { DEMO_USER_ID } from "@/domain/models";
import { SESSION_COOKIE_NAME } from "@/lib/auth-config";
import { hashPassword } from "@/lib/password";
import {
  authenticateDemoCredentials,
  resolveDemoSession,
  revokeDemoSession,
} from "@/lib/session-core";
import { proxy } from "@/proxy";

describe.sequential("persistent demo authentication", () => {
  beforeEach(async () => {
    await closeDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("uses a valid login as the lazy seed boundary before protected reads", async () => {
    const emptyDatabase = await getDatabase();
    // The RBAC migration creates only the root identity required by project
    // provenance; the canonical operational seed still remains lazy.
    await expect(emptyDatabase.select().from(users)).resolves.toHaveLength(1);

    const response = await login(
      jsonRequest("http://localhost/api/auth/login", {
        login: "demo",
        password: "MtrLocalTestOnly!",
      }),
    );
    expect(response.status).toBe(200);
    const token = (response.headers.get("set-cookie") ?? "").match(
      new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`),
    )?.[1];
    const protectedSession = await resolveDemoSession(token);
    expect(protectedSession?.user.id).toBe("demo-user-001");

    const repository = await getRepository();
    const [specifications, positions] = await Promise.all([
      repository.listSpecifications(protectedSession!.user.id),
      repository.listPositions(protectedSession!.user.id, { currentOnly: true }),
    ]);
    expect(specifications).toHaveLength(83);
    expect(positions).toHaveLength(3_584);
  });

  it("seeds only a password hash and persists an opaque revocable session", async () => {
    await expect(authenticateDemoCredentials("demo", "wrong")).resolves.toBeNull();
    const database = await getDatabase();
    const [user] = await database.select().from(users).limit(1);
    expect(user).toMatchObject({
      login: "demo",
      displayName: "Демо-пользователь 1",
      roles: ["USER", "ADMIN"],
    });
    expect(user?.passwordHash).toMatch(/^scrypt\$/);
    expect(user?.passwordHash).not.toContain("MtrLocalTestOnly!");
    await expect(authenticateDemoCredentials("demo", "Demo2026!")).resolves.toBeNull();

    const created = await authenticateDemoCredentials("demo", "MtrLocalTestOnly!");
    expect(created?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await resolveDemoSession(created?.token))?.user.displayName).toBe("Демо-пользователь 1");

    const [stored] = await database.select().from(authSessions).limit(1);
    expect(stored?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.tokenHash).not.toBe(created?.token);

    await revokeDemoSession(created?.token);
    await expect(resolveDemoSession(created?.token)).resolves.toBeNull();
  });

  it("accepts a rotated server-only password hash and rejects the fixture password", async () => {
    const previousHash = process.env.DEMO_PASSWORD_HASH;
    const rotatedPassword = "Rotated-test-only-password!";
    process.env.DEMO_PASSWORD_HASH = await hashPassword(rotatedPassword);
    try {
      await expect(authenticateDemoCredentials("demo", "MtrLocalTestOnly!")).resolves.toBeNull();
      const created = await authenticateDemoCredentials("demo", rotatedPassword);
      expect(created?.user.id).toBe("demo-user-001");
      await expect(resolveDemoSession(created?.token)).resolves.not.toBeNull();

      process.env.DEMO_PASSWORD_HASH = await hashPassword("Next-test-only-password!");
      await expect(resolveDemoSession(created?.token)).resolves.toBeNull();
    } finally {
      if (previousHash === undefined) delete process.env.DEMO_PASSWORD_HASH;
      else process.env.DEMO_PASSWORD_HASH = previousHash;
    }
  });

  it("не меняет сохранённые password hashes при seed/reset", async () => {
    const database = await getDatabase();
    await resetDemoDatabase(DEMO_USER_ID, database);
    const before = await database.select({ id: users.id, passwordHash: users.passwordHash }).from(users);
    const previousHash = process.env.DEMO_PASSWORD_HASH;
    process.env.DEMO_PASSWORD_HASH = await hashPassword("Reset-must-not-rotate-passwords!");
    try {
      await resetDemoDatabase(DEMO_USER_ID, database);
      const after = await database.select({ id: users.id, passwordHash: users.passwordHash }).from(users);
      expect(after.toSorted((left, right) => left.id.localeCompare(right.id))).toEqual(
        before.toSorted((left, right) => left.id.localeCompare(right.id)),
      );
    } finally {
      if (previousHash === undefined) delete process.env.DEMO_PASSWORD_HASH;
      else process.env.DEMO_PASSWORD_HASH = previousHash;
    }
  });

  it("returns a persistent cookie, rejects spoof fields and invalid credentials", async () => {
    const invalid = await login(
      jsonRequest("http://localhost/api/auth/login", { login: "demo", password: "wrong" }),
    );
    expect(invalid.status).toBe(401);
    expect(await invalid.json()).toMatchObject({ error: { code: "INVALID_CREDENTIALS" } });

    const spoof = await login(
      jsonRequest("http://localhost/api/auth/login", {
        login: "demo",
        password: "MtrLocalTestOnly!",
        user_id: "other-user",
      }),
    );
    expect(spoof.status).toBe(400);

    const response = await login(
      jsonRequest("http://localhost/api/auth/login", { login: "demo", password: "MtrLocalTestOnly!" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      user: { id: "demo-user-001", displayName: "Демо-пользователь 1", roles: ["USER", "ADMIN"] },
    });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
    const token = cookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`))?.[1];
    expect(await resolveDemoSession(token)).not.toBeNull();

    const loggedOut = await logout(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}`, host: "localhost" },
      }),
    );
    expect(loggedOut.status).toBe(204);
    await expect(resolveDemoSession(token)).resolves.toBeNull();
  });

  it("preserves promoted Appius and runtime records across initialize, login and logout", async () => {
    const database = await getDatabase();
    await resetDemoDatabase(DEMO_USER_ID, database);
    const repository = await getRepository();

    await new AppiusMockAdapter(repository).processNewVersionEvent({
      eventId: "auth-bootstrap-preserves-appius-v4",
      specificationId: "spec-demo-piping-001",
      previousVersionId: "spec-demo-piping-001-v2",
      currentVersionId: "spec-demo-piping-001-v3",
    }, DEMO_USER_ID);
    await repository.createRun(DEMO_USER_ID, {
      id: "run-auth-bootstrap-preserved",
      scenarioId: "scenario-full-analysis",
      specificationId: "spec-demo-piping-001",
      status: "COMPLETED",
      currentStep: "COMPLETED",
      progress: 100,
      inputSnapshot: { marker: "auth-bootstrap-preserved" },
      outputSnapshot: { marker: "auth-bootstrap-preserved" },
    });
    await repository.writeAudit(DEMO_USER_ID, {
      id: "audit-auth-bootstrap-preserved",
      action: "AUTH_BOOTSTRAP_RUNTIME_SENTINEL",
      entityType: "SCENARIO_RUN",
      entityId: "run-auth-bootstrap-preserved",
      outcome: "SUCCESS",
    });
    await repository.saveUploadedFile(DEMO_USER_ID, {
      id: "upload-auth-bootstrap-preserved",
      originalName: "runtime.csv",
      safeName: "runtime.csv",
      extension: ".csv",
      mimeType: "text/csv",
      sizeBytes: 4,
      checksumSha256: "a".repeat(64),
      storageUrl: "memory://runtime.csv",
      parseStatus: "PARSED",
      normalizedData: { rows: [{ marker: "auth-bootstrap-preserved" }] },
    });
    const thread = await repository.createAgentThread(
      DEMO_USER_ID,
      "Runtime preservation",
      "thread-auth-bootstrap-preserved",
    );
    await repository.appendAgentMessage(DEMO_USER_ID, {
      id: "message-auth-bootstrap-preserved",
      threadId: thread.id,
      role: "user",
      content: "runtime preservation marker",
    });

    const before = await repository.getCounts(DEMO_USER_ID);
    expect(before).toMatchObject({
      canonicalPositions: 3_584,
      sapMaterials: 30,
      sapBalances: 30,
      scenarioRuns: 1,
      uploadedFiles: 1,
      agentThreads: 1,
      agentMessages: 1,
    });
    expect(before.specificationVersions).toBeGreaterThanOrEqual(9);

    const initialized = await initializeDatabase();
    const loggedIn = await login(
      jsonRequest("http://localhost/api/auth/login", {
        login: "demo",
        password: "MtrLocalTestOnly!",
      }),
    );
    expect(loggedIn.status).toBe(200);
    const token = (loggedIn.headers.get("set-cookie") ?? "").match(
      new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`),
    )?.[1];
    expect(token).toBeDefined();
    const loggedOut = await logout(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}`, host: "localhost" },
      }),
    );
    expect(loggedOut.status).toBe(204);

    expect(initialized.seeded).toBe(false);
    await expect(repository.getRun(DEMO_USER_ID, "run-auth-bootstrap-preserved")).resolves.toBeTruthy();
    await expect(repository.getUploadedFile(DEMO_USER_ID, "upload-auth-bootstrap-preserved")).resolves.toBeTruthy();
    await expect(repository.listAuditLogs(DEMO_USER_ID, {
      action: "AUTH_BOOTSTRAP_RUNTIME_SENTINEL",
    })).resolves.toHaveLength(1);
    await expect(repository.listAgentThreads(DEMO_USER_ID)).resolves.toContainEqual(
      expect.objectContaining({ id: "thread-auth-bootstrap-preserved" }),
    );
    await expect(repository.listAgentMessages(
      DEMO_USER_ID,
      "thread-auth-bootstrap-preserved",
    )).resolves.toContainEqual(expect.objectContaining({
      message: expect.objectContaining({ id: "message-auth-bootstrap-preserved" }),
    }));

    const versions = await repository.listSpecificationVersions(
      DEMO_USER_ID,
      "spec-demo-piping-001",
    );
    expect(versions.find((version) => version.id === "spec-demo-piping-001-v4")).toMatchObject({
      isCurrent: true,
      status: "ACTIVE",
    });
    await expect(repository.listPositions(DEMO_USER_ID, {
      currentOnly: true,
    })).resolves.toHaveLength(3_584);
    const after = await repository.getCounts(DEMO_USER_ID);
    expect(after).toMatchObject({
      canonicalPositions: 3_584,
      sapMaterials: 30,
      sapBalances: 30,
      scenarioRuns: 1,
      uploadedFiles: 1,
      agentThreads: 1,
      agentMessages: 1,
    });
    expect(after.specificationVersions).toBeGreaterThanOrEqual(9);
  });

  it("redirects anonymous pages, rejects anonymous APIs and enforces ADMIN", async () => {
    const pageResponse = await proxy(new NextRequest("http://localhost/reports/run-1?view=full"));
    expect(pageResponse.status).toBe(307);
    expect(pageResponse.headers.get("location")).toBe(
      "http://localhost/login?next=%2Freports%2Frun-1%3Fview%3Dfull",
    );

    const apiResponse = await proxy(new NextRequest("http://localhost/api/scenario-runs"));
    expect(apiResponse.status).toBe(401);
    expect(await apiResponse.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });

    const session = await authenticateDemoCredentials("demo", "MtrLocalTestOnly!");
    expect(session).not.toBeNull();
    const authenticated = (path: string) =>
      new NextRequest(`http://localhost${path}`, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${session?.token}` },
      });
    expect((await proxy(authenticated("/admin/scenarios"))).status).toBe(200);

    const database = await getDatabase();
    try {
      await database.execute(sql`update role_assignments set status='REVOKED' where id='assign-demo-admin'`);
      const forbidden = await proxy(authenticated("/api/admin/integrations"));
      expect(forbidden.status).toBe(403);
    } finally {
      await database.execute(sql`update role_assignments set status='ACTIVE', revoked_at=null, revoked_by=null where id='assign-demo-admin'`);
    }
  });

  it("blocks cross-origin protected mutations without affecting trusted operational clients", async () => {
    const session = await authenticateDemoCredentials("demo", "MtrLocalTestOnly!");
    expect(session).not.toBeNull();

    const protectedMutations = [
      { path: "/api/scenario-runs/run-original/retry", method: "POST" },
      { path: "/api/admin/integrations", method: "PATCH" },
    ] as const;

    for (const mutation of protectedMutations) {
      const crossOrigin = await proxy(
        authenticatedRequest(session!.token, mutation.path, mutation.method, {
          host: "mtr.example",
          origin: "https://attacker.example",
        }),
      );
      expect(crossOrigin.status, mutation.path).toBe(403);
      expect(await crossOrigin.json()).toMatchObject({ error: { code: "INVALID_ORIGIN" } });

      const sameOrigin = await proxy(
        authenticatedRequest(session!.token, mutation.path, mutation.method, {
          host: "mtr.example",
          origin: "https://mtr.example",
        }),
      );
      expect(sameOrigin.status, mutation.path).toBe(200);

      const withoutOrigin = await proxy(
        authenticatedRequest(session!.token, mutation.path, mutation.method, {
          host: "mtr.example",
        }),
      );
      expect(withoutOrigin.status, mutation.path).toBe(200);
    }

    const forwardedHost = await proxy(
      authenticatedRequest(session!.token, "/api/admin/integrations", "PATCH", {
        host: "mtr-ai-demo.internal",
        "x-forwarded-host": "mtr.example",
        origin: "https://mtr.example",
      }),
    );
    expect(forwardedHost.status).toBe(200);

    for (const method of ["GET", "OPTIONS"] as const) {
      const safeRequest = await proxy(
        authenticatedRequest(session!.token, "/api/admin/integrations", method, {
          host: "mtr.example",
          origin: "https://attacker.example",
        }),
      );
      expect(safeRequest.status, method).toBe(200);
    }
  });

  it("switches between synthetic demo personas and revokes the previous session", async () => {
    const previousFlag = process.env.DEMO_ROLE_SELECTOR;
    process.env.DEMO_ROLE_SELECTOR = "true";
    try {
      const viewer = await authenticateDemoCredentials("viewer", "MtrLocalTestOnly!");
      expect(viewer).not.toBeNull();
      const response = await switchRole(new Request("http://localhost/api/auth/switch-role", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE_NAME}=${viewer!.token}`, host: "localhost", origin: "http://localhost" },
        body: JSON.stringify({ login: "director" }),
      }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ user: { login: "director" }, redirectTo: "/" });
      await expect(resolveDemoSession(viewer!.token)).resolves.toBeNull();
      const nextToken = response.headers.get("set-cookie")?.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`))?.[1];
      await expect(resolveDemoSession(nextToken)).resolves.toMatchObject({ user: { login: "director", displayName: "Руководитель" } });
    } finally {
      if (previousFlag === undefined) delete process.env.DEMO_ROLE_SELECTOR;
      else process.env.DEMO_ROLE_SELECTOR = previousFlag;
    }
  });
});

function jsonRequest(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", host: "localhost" },
    body: JSON.stringify(body),
  });
}

function authenticatedRequest(
  token: string,
  path: string,
  method: string,
  headers: Record<string, string>,
): NextRequest {
  return new NextRequest(`https://mtr.example${path}`, {
    method,
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
      ...headers,
    },
  });
}

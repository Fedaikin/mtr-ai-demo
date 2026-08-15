import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({
  requirePermission: vi.fn(async () => ({
    user: {
      id: "demo-user-001",
      displayName: "Демо-пользователь 1",
      roles: ["USER", "ADMIN"],
      locale: "ru-RU",
    },
    authorization: {
      subjectId: "demo-user-001",
      displayName: "Демо-пользователь 1",
      activeRoleAssignmentIds: ["assign-demo-manager", "assign-demo-admin"],
      globalRoleKeys: ["SYSTEM_ADMIN"],
      activeProjectId: "demo-project-001",
      projectRoleKeys: ["PROJECT_MANAGER"],
      permissionKeys: new Set(["agent.chat", "project.read", "user.manage", "global_role.manage", "project.members.manage"]),
      catalogScopeIds: ["demo-catalog-001"],
      sourceScopeIds: ["demo-appius-001"],
      accessClaims: {},
      authorizationVersion: 1,
      requestId: "request-privileged-action-route",
    },
  })),
  SessionError: class SessionError extends Error {
    constructor(message: string, readonly status: 401 | 403) {
      super(message);
    }
  },
}));

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { getRepository } from "@/adapters/persistence/repository";
import { POST as confirmAction } from "@/app/api/agent/actions/[id]/confirm/route";
import { POST as postMessage } from "@/app/api/agent/threads/[id]/messages/route";
import { DEMO_USER_ID } from "@/domain/models";

describe.sequential("privileged action HTTP lifecycle", () => {
  beforeEach(async () => {
    vi.stubEnv("MTR_AGENT_ORCHESTRATOR_ENABLED", "true");
    vi.stubEnv("MTR_AGENT_ACTIONS_ENABLED", "true");
    vi.stubEnv("MTR_AGENT_KILL_SWITCH", "false");
    await resetDemoDatabase(DEMO_USER_ID);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDatabase();
  });

  it("uses the same chat path, changes nothing before confirm and publishes a safe card", async () => {
    const repository = await getRepository();
    const thread = await repository.createAgentThread(DEMO_USER_ID, "Управление доступом");
    const response = await postMessage(
      new Request(`http://localhost/api/agent/threads/${thread.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "Заблокируй сотрудника analyst",
          threadId: thread.id,
          selection: { projectId: "demo-project-001" },
        }),
      }),
      { params: Promise.resolve({ id: thread.id }) },
    );
    const responseBody = await response.clone().json();
    expect(response.status, JSON.stringify(responseBody)).toBe(201);
    const body = await response.json() as {
      items: Array<{ structuredOutput?: { actionProposal?: { id: string; parameters: unknown; status: string } } }>;
    };
    const proposal = body.items.at(-1)?.structuredOutput?.actionProposal;
    expect(proposal).toMatchObject({ status: "PROPOSED" });
    expect(JSON.stringify(proposal)).not.toContain("demo-analyst-001");
    await expect(userStatus("demo-analyst-001")).resolves.toBe("ACTIVE");

    const confirmed = await confirmAction(
      new Request(`http://localhost/api/agent/actions/${proposal!.id}/confirm`, { method: "POST" }),
      { params: Promise.resolve({ id: proposal!.id }) },
    );
    expect(confirmed.status).toBe(200);
    await expect(userStatus("demo-analyst-001")).resolves.toBe("BLOCKED");
  });

  it("blocks confirm at the server boundary in PROPOSE_ONLY mode", async () => {
    vi.stubEnv("MTR_AGENT_ACTION_MODE", "PROPOSE_ONLY");
    const before = await userStatus("demo-analyst-001");
    const response = await confirmAction(
      new Request("http://localhost/api/agent/actions/action-does-not-matter/confirm", { method: "POST" }),
      { params: Promise.resolve({ id: "action-does-not-matter" }) },
    );
    const body = await response.json() as { error?: { code?: string } };

    expect(response.status).toBe(409);
    expect(body.error?.code).toBe("MTR_AGENT_ACTION_CONFIRMATION_DISABLED");
    await expect(userStatus("demo-analyst-001")).resolves.toBe(before);
  });
});

async function userStatus(userId: string): Promise<string> {
  const db = await getDatabase({ migrations: "skip" });
  const result = await db.execute(sql`select status from users where id=${userId}`);
  const rows = Array.isArray(result)
    ? result
    : result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)
      ? result.rows
      : [];
  return String((rows[0] as Record<string, unknown> | undefined)?.status ?? "");
}

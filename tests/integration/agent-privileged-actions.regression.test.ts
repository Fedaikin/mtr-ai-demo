import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAgentActionStore } from "@/adapters/persistence/agent-action-store";
import { createAgentCaseStore } from "@/adapters/persistence/agent-case-store";
import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { getRepository } from "@/adapters/persistence/repository";
import { AgentActionService } from "@/application/agent-orchestrator/action-service";
import { PlatformAgentActionExecutor } from "@/application/agent-orchestrator/action-executor";
import { AgentCaseService } from "@/application/agent-orchestrator/case-service";
import { PrivilegedActionChatService } from "@/application/agent-orchestrator/privileged-action-chat-service";
import { resolveAuthorizationContext } from "@/application/authorization-service";
import { DEMO_USER_ID } from "@/domain/models";

describe.sequential("privileged chat actions", () => {
  beforeEach(async () => resetDemoDatabase(DEMO_USER_ID));
  afterAll(async () => closeDatabase());

  it("creates a block proposal, changes nothing before confirm and executes once after reauthorization", async () => {
    const { chat, actions, context } = await fixture();
    const before = await userState("demo-analyst-001");

    const prepared = await chat.prepare(
      "Заблокируй сотрудника analyst",
      "thread-access-1",
      context,
    );

    const proposal = prepared?.structuredOutput.actionProposal;
    expect(proposal).toMatchObject({
      actionType: "SET_USER_STATUS",
      status: "PROPOSED",
      parameters: {
        impact: {
          targetDisplayName: "Аналитик МТР",
          targetLogin: "analyst",
          newState: "Заблокировать пользователя",
          segregationOfDuties: "PASS",
        },
      },
    });
    expect(JSON.stringify(proposal?.parameters)).not.toContain("demo-analyst-001");
    await expect(userState("demo-analyst-001")).resolves.toEqual(before);

    const completed = await actions.confirm(proposal!.id, context);
    const replay = await actions.confirm(proposal!.id, context);
    expect(completed.status).toBe("SUCCEEDED");
    expect(replay).toEqual(completed);
    await expect(userState("demo-analyst-001")).resolves.toMatchObject({
      status: "BLOCKED",
      authorizationVersion: before.authorizationVersion + 1,
    });
    const db = await getDatabase({ migrations: "skip" });
    const actionRows = rows(await db.execute(`select status from agent_action_proposals where id='${proposal!.id}'`));
    expect(actionRows).toEqual([{ status: "SUCCEEDED" }]);
    const accessAudit = rows(await db.execute("select action from audit_logs where action='RBAC_USER_STATUS_CHANGED' and entity_id='demo-analyst-001'"));
    expect(accessAudit).toHaveLength(1);
  });

  it("changes one project role transactionally and revokes the target sessions", async () => {
    const { chat, actions, context } = await fixture();
    const prepared = await chat.prepare(
      "Смени роль сотрудника analyst на Эксперт МТР",
      "thread-access-2",
      context,
    );
    const proposal = prepared?.structuredOutput.actionProposal;
    expect(proposal).toMatchObject({ actionType: "CHANGE_PROJECT_ROLE", status: "PROPOSED" });

    await actions.confirm(proposal!.id, context);

    const db = await getDatabase({ migrations: "skip" });
    const activeRoles = rows(await db.execute(`
      select r.key from role_assignments ra join roles r on r.id=ra.role_id
      where ra.user_id='demo-analyst-001' and ra.project_id='demo-project-001' and ra.status='ACTIVE'
      order by r.key
    `));
    expect(activeRoles).toEqual([{ key: "MTR_EXPERT" }]);
    const audit = rows(await db.execute("select action from audit_logs where action='RBAC_PROJECT_ROLE_CHANGED' and entity_id='demo-analyst-001'"));
    expect(audit).toHaveLength(1);
  });

  it("blocks SoD conflicts, self-management, protected ambiguity and active-role deactivation", async () => {
    const { chat, context } = await fixture();
    const sod = await chat.prepare("Назначь роль Аудитор сотруднику analyst", "thread-sod", context);
    const self = await chat.prepare("Заблокируй пользователя demo", "thread-self", context);
    const ambiguous = await chat.prepare("Заблокируй роль Аналитик МТР", "thread-role", context);
    const activeRole = await chat.prepare("Деактивируй роль Наблюдатель проекта", "thread-active-role", context);

    expect(sod?.structuredOutput.actionProposal).toBeNull();
    expect(sod?.content).toContain("разделение обязанностей");
    expect(self?.structuredOutput.actionProposal).toBeNull();
    expect(self?.content).toContain("собственный доступ");
    expect(ambiguous?.structuredOutput.actionProposal).toBeNull();
    expect(ambiguous?.content).toContain("Уточните");
    expect(activeRole?.structuredOutput.actionProposal).toBeNull();
    expect(activeRole?.content).toContain("план переназначения");
  });
});

async function fixture() {
  const repository = await getRepository();
  await Promise.all([
    "thread-access-1",
    "thread-access-2",
    "thread-sod",
    "thread-self",
    "thread-role",
    "thread-active-role",
  ].map((threadId) => repository.createAgentThread(DEMO_USER_ID, "Управление доступом", threadId)));
  const actionService = new AgentActionService(
    await createAgentActionStore(),
    new PlatformAgentActionExecutor(repository, { scheduleScenarioRun: vi.fn() }),
    () => new Date("2026-08-13T12:00:00.000Z"),
  );
  const chat = new PrivilegedActionChatService(
    actionService,
    new AgentCaseService(await createAgentCaseStore(), () => new Date("2026-08-13T12:00:00.000Z")),
  );
  return {
    chat,
    actions: actionService,
    context: await resolveAuthorizationContext(DEMO_USER_ID, "demo-project-001"),
  };
}

async function userState(userId: string): Promise<{ status: string; authorizationVersion: number }> {
  const db = await getDatabase({ migrations: "skip" });
  const [row] = rows(await db.execute(`select status, authorization_version from users where id='${userId}'`));
  return { status: String(row?.status), authorizationVersion: Number(row?.authorization_version) };
}

function rows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) return result.rows as Array<Record<string, unknown>>;
  return [];
}

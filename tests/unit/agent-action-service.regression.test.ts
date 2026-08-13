import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  AgentActionService,
  type AgentActionExecutor,
  type AgentActionStore,
} from "@/application/agent-orchestrator/action-service";
import type { TrustedRequestContext } from "@/application/authorization-service";
import type { AgentActionProposal } from "@/domain/agent/actions";

describe("безопасные L2-действия МТР-агента", () => {
  it("создаёт только разрешённое предложение и не выполняет его без confirm", async () => {
    const store = memoryStore();
    const execute = vi.fn();
    const service = new AgentActionService(store, executor(execute), () => new Date("2026-08-13T12:00:00.000Z"));

    const proposal = await service.propose(
      {
        caseId: "case-1",
        actionType: "PREPARE_REPORT_DRAFT",
        resource: { resourceType: "SCENARIO_RUN", resourceId: "run-1", projectId: "project-1", ownerUserId: "user-1", status: "COMPLETED" },
        summary: "Подготовить черновик отчёта",
        consequences: ["Будет создан только черновик без публикации"],
        parameters: { format: "PDF", token: "secret-must-not-survive" },
        requestKey: "report-run-1",
      },
      context(["agent.chat", "report.read"]),
    );

    expect(proposal.status).toBe("PROPOSED");
    expect(proposal.parameters).toEqual({ format: "PDF" });
    expect(execute).not.toHaveBeenCalled();
    expect(store.createOrGetWithAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "agent.action.proposed", outcome: "SUCCESS" }),
    );
  });

  it("повторно авторизует confirm и отклоняет смену authorizationVersion", async () => {
    const store = memoryStore();
    const service = new AgentActionService(store, executor(vi.fn()), () => new Date("2026-08-13T12:00:00.000Z"));
    const proposed = await service.propose(input(), context(["agent.chat", "analysis.create"]));

    await expect(
      service.confirm(proposed.id, context(["agent.chat", "analysis.create"], { authorizationVersion: 8 })),
    ).rejects.toMatchObject({ code: "ACTION_AUTHORIZATION_CHANGED" });
    expect(store.claimForExecution).not.toHaveBeenCalled();
  });

  it("идемпотентно возвращает выполненное действие без второго side effect", async () => {
    const store = memoryStore();
    const execute = vi.fn(async () => ({ resourceType: "SCENARIO_RUN", resourceId: "run-2", status: "ACCEPTED" as const, safeSummary: "Запуск принят", link: "/runs/run-2" }));
    const service = new AgentActionService(store, executor(execute), () => new Date("2026-08-13T12:00:00.000Z"));
    const proposed = await service.propose(input(), context(["agent.chat", "analysis.create"]));

    const first = await service.confirm(proposed.id, context(["agent.chat", "analysis.create"]));
    const second = await service.confirm(proposed.id, context(["agent.chat", "analysis.create"]));

    expect(first.status).toBe("SUCCEEDED");
    expect(second).toEqual(first);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.completeWithAudit).toHaveBeenCalledTimes(1);
  });

  it.each(["DECIDE_EXPERT_REVIEW", "SAP_WRITE", "APPIUS_WRITE"])(
    "запрещает неподдерживаемое действие %s",
    async (actionType) => {
      const service = new AgentActionService(memoryStore(), executor(vi.fn()));
      await expect(service.propose({ ...input(), actionType } as never, context(["agent.chat", "analysis.create"])))
        .rejects.toMatchObject({ code: "ACTION_VALIDATION_ERROR" });
    },
  );
});

function input() {
  return {
    caseId: "case-1",
    actionType: "RUN_SCENARIO" as const,
    resource: { resourceType: "SCENARIO_TEMPLATE", resourceId: "scenario-1", projectId: "project-1", ownerUserId: "user-1", status: "AVAILABLE" },
    summary: "Запустить стандартный анализ",
    consequences: ["Будет создан новый запуск анализа"],
    parameters: { specificationId: "spec-1" },
    requestKey: "run-spec-1",
  };
}

function context(permissions: string[], patch: Partial<TrustedRequestContext> = {}): TrustedRequestContext {
  return {
    subjectId: "user-1",
    displayName: "Аналитик",
    activeRoleAssignmentIds: ["assignment-1"],
    globalRoleKeys: [],
    activeProjectId: "project-1",
    projectRoleKeys: ["MTR_ANALYST"],
    permissionKeys: new Set(permissions as TrustedRequestContext["permissionKeys"] extends ReadonlySet<infer T> ? T[] : never),
    catalogScopeIds: ["catalog-1"],
    sourceScopeIds: ["sap-1"],
    accessClaims: {},
    authorizationVersion: 7,
    requestId: "request-1",
    ...patch,
  };
}

function executor(execute: ReturnType<typeof vi.fn>): AgentActionExecutor {
  const invoke = execute as unknown as (
    proposal: AgentActionProposal,
    context: TrustedRequestContext,
  ) => unknown;
  return {
    resolveCurrent: vi.fn(async (proposal: AgentActionProposal) => proposal.resource),
    async execute(proposal, context) {
      return await invoke(proposal, context) as Awaited<ReturnType<AgentActionExecutor["execute"]>>;
    },
  };
}

function memoryStore(): AgentActionStore & Record<string, ReturnType<typeof vi.fn>> {
  const values = new Map<string, AgentActionProposal>();
  const store = {
    createOrGetWithAudit: vi.fn(async (proposal: AgentActionProposal) => {
      const existing = [...values.values()].find((item) => item.idempotencyKey === proposal.idempotencyKey);
      if (existing) return existing;
      values.set(proposal.id, proposal);
      return proposal;
    }),
    getAuthorized: vi.fn(async (id: string, subjectId: string, projectId: string) => {
      const value = values.get(id);
      return value?.proposedBy === subjectId && value.projectId === projectId ? value : null;
    }),
    claimForExecution: vi.fn(async (id: string, version: number, updatedAt: string) => {
      const value = values.get(id)!;
      if (value.status === "SUCCEEDED" || value.status === "EXECUTING") return { outcome: "EXISTING" as const, proposal: value };
      const claimed = { ...value, status: "EXECUTING" as const, version: version + 1, updatedAt };
      values.set(id, claimed);
      return { outcome: "CLAIMED" as const, proposal: claimed };
    }),
    completeWithAudit: vi.fn(async (id: string, version: number, result: AgentActionProposal["result"], updatedAt: string) => {
      const value = values.get(id)!;
      const completed = { ...value, status: "SUCCEEDED" as const, result, version: version + 1, updatedAt };
      values.set(id, completed);
      return completed;
    }),
    failWithAudit: vi.fn(),
    cancelWithAudit: vi.fn(),
  };
  return store;
}

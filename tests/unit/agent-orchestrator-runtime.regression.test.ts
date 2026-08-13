import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TrustedRequestContext } from "@/application/authorization-service";
import {
  agentChatInputSchema,
  MtrAgentOrchestrator,
} from "@/application/agent-orchestrator/orchestrator";
import type { GroundedAgentOutput } from "@/domain/models";

vi.mock("server-only", () => ({}));

const output: GroundedAgentOutput = {
  answer: "Подтверждённый ответ",
  facts: [],
  recommendations: [],
  citations: [],
  confidence: 1,
  requiresHumanReview: false,
  toolCalls: [],
};

describe("MtrAgentOrchestrator trust boundary", () => {
  const legacyRespond = vi.fn(async () => output);

  beforeEach(() => {
    legacyRespond.mockClear();
  });

  it("передаёт legacy capability только серверный subject после canonical validation", async () => {
    const authorization = trustedContext();
    const orchestrator = new MtrAgentOrchestrator({ respond: legacyRespond });

    const result = await orchestrator.handle(
      {
        kind: "CHAT",
        message: "Покажи актуальную спецификацию",
        threadId: "thread-1",
        selection: { projectId: "project-1", specificationId: "specification-1" },
        correlationId: "request-1",
        promptVersion: "prompt-v1",
      },
      authorization,
    );

    expect(result).toEqual({ kind: "CHAT", output });
    expect(legacyRespond).toHaveBeenCalledWith(
      {
        message: "Покажи актуальную спецификацию",
        threadId: "thread-1",
        userId: "subject-1",
        correlationId: "request-1",
        promptVersion: "prompt-v1",
      },
    );
  });

  it("отклоняет чужой project до вызова legacy capability", async () => {
    const orchestrator = new MtrAgentOrchestrator({ respond: legacyRespond });

    await expect(
      orchestrator.handle(
        {
          kind: "CHAT",
          message: "Покажи остатки",
          selection: { projectId: "project-foreign" },
        },
        trustedContext(),
      ),
    ).rejects.toMatchObject({ code: "AGENT_PROJECT_CONTEXT_DENIED" });
    expect(legacyRespond).not.toHaveBeenCalled();
  });

  it("проверяет agent.chat внутри orchestrator до вызова legacy capability", async () => {
    const orchestrator = new MtrAgentOrchestrator({ respond: legacyRespond });

    await expect(
      orchestrator.handle(
        { kind: "CHAT", message: "Покажи остатки", selection: { projectId: "project-1" } },
        trustedContext(new Set()),
      ),
    ).rejects.toMatchObject({ permission: "agent.chat" });
    expect(legacyRespond).not.toHaveBeenCalled();
  });

  it.each([
    {
      kind: "COMMAND" as const,
      commandKey: "SUMMARY" as const,
      selection: { projectId: "project-1" },
    },
    {
      kind: "EVENT" as const,
      eventType: "SPECIFICATION_PUBLISHED",
      entityId: "specification-1",
      occurredAt: "2026-08-13T00:00:00.000Z",
      selection: { projectId: "project-1" },
    },
  ])("держит канал $kind закрытым, пока capability не подключена", async (request) => {
    const orchestrator = new MtrAgentOrchestrator({ respond: legacyRespond });

    await expect(orchestrator.handle(request, trustedContext())).rejects.toMatchObject({
      channel: request.kind,
    });
    expect(legacyRespond).not.toHaveBeenCalled();
  });

  it.each(["userId", "subjectId", "role", "permissions", "authorizationVersion"])(
    "не принимает доверенное поле %s из chat body",
    (field) => {
      expect(() =>
        agentChatInputSchema.parse({
          message: "Покажи остатки",
          threadId: "thread-1",
          selection: { projectId: "project-1" },
          [field]: "forged",
        }),
      ).toThrow();
    },
  );

  it("строго отклоняет доверенные поля внутри selection", () => {
    expect(() =>
      agentChatInputSchema.parse({
        message: "Покажи остатки",
        threadId: "thread-1",
        selection: { projectId: "project-1", permissionKeys: ["stock.search"] },
      }),
    ).toThrow();
  });
});

function trustedContext(
  permissionKeys: TrustedRequestContext["permissionKeys"] = new Set(["agent.chat"]),
): TrustedRequestContext {
  return {
    subjectId: "subject-1",
    displayName: "Тестовый пользователь",
    activeRoleAssignmentIds: ["assignment-1"],
    globalRoleKeys: [],
    activeProjectId: "project-1",
    projectRoleKeys: ["PROJECT_VIEWER"],
    permissionKeys,
    catalogScopeIds: ["catalog-1"],
    sourceScopeIds: ["source-1"],
    accessClaims: { warehouseIds: ["warehouse-1"] },
    authorizationVersion: 7,
    requestId: "request-1",
  };
}

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
  const executeCommand = vi.fn();

  beforeEach(() => {
    legacyRespond.mockClear();
    executeCommand.mockReset();
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

  it("направляет естественный typed intent в ту же command capability, минуя legacy runtime", async () => {
    const commandOutput = {
      responseType: "STOCKS" as const,
      title: "Остатки",
      summary: "Найдена одна позиция.",
      items: [],
      citations: [],
      missingData: [],
      confidence: 0.8,
      requiresHumanReview: false,
      negativeEvidence: "NOT_EMPTY" as const,
      generatedAt: "2026-08-13T10:00:00.000Z",
    };
    executeCommand.mockResolvedValue(commandOutput);
    const orchestrator = new MtrAgentOrchestrator(
      { respond: legacyRespond },
      { execute: executeCommand },
    );

    await expect(orchestrator.handle({
      kind: "CHAT",
      message: "Покажи остатки SAP-DEMO-0001 на WH-DEMO-NORTH",
      selection: { projectId: "project-1" },
      correlationId: "natural-command-1",
    }, trustedContext(new Set(["agent.chat", "stock.search"]))))
      .resolves.toEqual({ kind: "COMMAND", output: commandOutput });
    expect(executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: "natural-command-1" }),
      {
        commandKey: "STOCKS",
        context: { projectId: "project-1" },
        filters: { materialCode: "SAP-DEMO-0001", warehouseIds: ["WH-DEMO-NORTH"] },
      },
    );
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
      eventId: "event-1",
      eventType: "SPECIFICATION_PUBLISHED",
      entityId: "specification-1",
      stateVersion: "v1",
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

  it("принимает attachment без команды и не принимает identity внутри attachment", () => {
    expect(agentChatInputSchema.parse({
      message: "",
      threadId: "thread-1",
      attachments: [{ uploadId: "upload-1", purpose: "SPECIFICATION" }],
    })).toMatchObject({ attachments: [{ uploadId: "upload-1", purpose: "SPECIFICATION" }] });
    expect(() => agentChatInputSchema.parse({
      message: "Проверь файл",
      attachments: [{ uploadId: "upload-1", purpose: "SPECIFICATION", userId: "forged" }],
    })).toThrow();
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

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { TrustedRequestContext } from "@/application/authorization-service";
import { MtrAgentOrchestrator } from "@/application/agent-orchestrator/orchestrator";
import type { UniversalAgentAnswer } from "@/domain/agent/universal-chat/answer";
import type { GroundedAgentOutput } from "@/domain/models";

const legacyOutput: GroundedAgentOutput = {
  answer: "Legacy",
  facts: [],
  recommendations: [],
  citations: [],
  confidence: 1,
  requiresHumanReview: false,
  toolCalls: [],
};

const universalOutput: UniversalAgentAnswer = {
  summary: "Подтверждённая проектная сводка",
  resolvedContext: {},
  facts: [],
  tables: [],
  risks: [],
  compatibility: [],
  recommendations: [],
  actions: [],
  citations: [],
  missingData: [],
  confidence: 1,
  requiresHumanReview: false,
  generatedAt: "2026-08-13T09:15:00.000Z",
  mode: "DETERMINISTIC_FALLBACK",
};

describe("universal capability in the single MtrAgentOrchestrator", () => {
  it("направляет поддержанный естественный вопрос в universal runtime раньше legacy", async () => {
    const legacy = { respond: vi.fn(async () => legacyOutput) };
    const universal = { respond: vi.fn(async () => universalOutput) };
    const orchestrator = new MtrAgentOrchestrator(legacy, undefined, undefined, universal);

    await expect(orchestrator.handle({
      kind: "CHAT",
      message: "Какой остаток труб по проекту?",
      threadId: "thread-1",
    }, trusted())).resolves.toEqual({ kind: "UNIVERSAL", output: universalOutput });
    expect(universal.respond).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread-1" }),
      expect.objectContaining({ trusted: expect.objectContaining({ subjectId: "demo-user-001" }) }),
    );
    expect(legacy.respond).not.toHaveBeenCalled();
  });

  it("оставляет legacy fallback для неподдержанного вопроса", async () => {
    const legacy = { respond: vi.fn(async () => legacyOutput) };
    const universal = { respond: vi.fn(async () => null) };
    const orchestrator = new MtrAgentOrchestrator(legacy, undefined, undefined, universal);

    await expect(orchestrator.handle({ kind: "CHAT", message: "Неподдержанный вопрос" }, trusted()))
      .resolves.toEqual({ kind: "CHAT", output: legacyOutput });
    expect(legacy.respond).toHaveBeenCalledOnce();
  });

  it("не вызывает universal capability без agent.chat", async () => {
    const universal = { respond: vi.fn(async () => universalOutput) };
    const orchestrator = new MtrAgentOrchestrator(
      { respond: vi.fn(async () => legacyOutput) },
      undefined,
      undefined,
      universal,
    );

    await expect(orchestrator.handle(
      { kind: "CHAT", message: "Покажи проекты" },
      trusted(new Set()),
    )).rejects.toMatchObject({ permission: "agent.chat" });
    expect(universal.respond).not.toHaveBeenCalled();
  });
});

function trusted(
  permissionKeys: TrustedRequestContext["permissionKeys"] = new Set(["agent.chat"]),
): TrustedRequestContext {
  return {
    subjectId: "demo-user-001",
    displayName: "Демо-пользователь 1",
    activeRoleAssignmentIds: ["assignment-1"],
    globalRoleKeys: [],
    activeProjectId: "demo-project-001",
    projectRoleKeys: ["PROJECT_MANAGER"],
    permissionKeys,
    catalogScopeIds: ["demo-catalog-001"],
    sourceScopeIds: ["demo-sap-001"],
    accessClaims: { warehouseIds: ["WH-DEMO-NORTH"] },
    authorizationVersion: 1,
    requestId: "request-universal-orchestrator",
  };
}

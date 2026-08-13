import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuditedAgentCommandCapability } from "@/application/agent-orchestrator/audited-command-capability";
import type { TrustedRequestContext } from "@/application/authorization-service";
import { createAgentExecutionContext } from "@/domain/agent/context";

describe("shared command audit capability", () => {
  const execute = vi.fn();
  const writeAudit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    writeAudit.mockResolvedValue({ id: "audit-1" });
    execute.mockResolvedValue({
      responseType: "STOCKS",
      title: "Остатки",
      summary: "Найдена одна позиция.",
      items: [],
      citations: [],
      missingData: [],
      confidence: 0.8,
      requiresHumanReview: false,
      negativeEvidence: "NOT_EMPTY",
      generatedAt: "2026-08-13T10:00:00.000Z",
    });
  });

  it("пишет received/completed для любого entry channel без raw значений фильтра", async () => {
    const capability = new AuditedAgentCommandCapability(
      { execute },
      { writeAudit },
      vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(112),
    );
    const context = createAgentExecutionContext(trusted(), {
      selection: { projectId: "project-1" },
      correlationId: "correlation-1",
    });

    await capability.execute(context, {
      commandKey: "STOCKS",
      context: { projectId: "project-1" },
      filters: { query: "закрытое название", warehouseIds: ["WH-1", "WH-2"] },
    });

    expect(writeAudit).toHaveBeenCalledTimes(2);
    expect(writeAudit.mock.calls[0]?.[1]).toMatchObject({
      action: "agent.command.received",
      requestId: "correlation-1",
      details: {
        commandKey: "STOCKS",
        projectId: "project-1",
        authorizationVersion: 7,
        filters: { filterKeys: ["query", "warehouseIds"], hasQuery: true, warehouseCount: 2 },
      },
    });
    expect(writeAudit.mock.calls[1]?.[1]).toMatchObject({
      action: "agent.command.completed",
      requestId: "correlation-1",
      details: { durationMs: 12, confidence: 0.8 },
    });
    expect(JSON.stringify(writeAudit.mock.calls)).not.toContain("закрытое название");
  });

  it("не выполняет команду при недоступном обязательном received audit", async () => {
    writeAudit.mockRejectedValueOnce(new Error("audit unavailable"));
    const capability = new AuditedAgentCommandCapability({ execute }, { writeAudit });

    await expect(capability.execute(createAgentExecutionContext(trusted()), {
      commandKey: "SUMMARY",
      context: { projectId: "project-1" },
    })).rejects.toThrow("audit unavailable");
    expect(execute).not.toHaveBeenCalled();
  });

  it("пишет безопасный failure audit", async () => {
    execute.mockRejectedValue(Object.assign(new Error("закрытая причина"), { code: "SOURCE_DOWN" }));
    const capability = new AuditedAgentCommandCapability({ execute }, { writeAudit });

    await expect(capability.execute(createAgentExecutionContext(trusted()), {
      commandKey: "RISKS",
      context: { projectId: "project-1" },
    })).rejects.toThrow("закрытая причина");
    expect(writeAudit.mock.calls[1]?.[1]).toMatchObject({
      action: "agent.command.failed",
      outcome: "FAILURE",
      details: { errorCode: "SOURCE_DOWN" },
    });
    expect(JSON.stringify(writeAudit.mock.calls)).not.toContain("закрытая причина");
  });
});

function trusted(): TrustedRequestContext {
  return {
    subjectId: "subject-1",
    displayName: "Аналитик",
    activeRoleAssignmentIds: ["assignment-1"],
    globalRoleKeys: [],
    activeProjectId: "project-1",
    projectRoleKeys: ["MTR_ANALYST"],
    permissionKeys: new Set(["agent.chat", "project.read", "stock.search", "analysis.read"]),
    catalogScopeIds: ["catalog-1"],
    sourceScopeIds: ["sap-1"],
    accessClaims: { warehouseIds: ["WH-1", "WH-2"] },
    authorizationVersion: 7,
    requestId: "request-1",
  };
}

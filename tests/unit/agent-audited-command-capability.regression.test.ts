import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuditedAgentCommandCapability } from "@/application/agent-orchestrator/audited-command-capability";
import type { TrustedRequestContext } from "@/application/authorization-service";
import { createAgentExecutionContext } from "@/domain/agent/context";

describe("shared command audit capability", () => {
  const execute = vi.fn();
  const writeAudit = vi.fn();
  const startAgentCommandPlan = vi.fn();
  const finishAgentCommandPlan = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    writeAudit.mockResolvedValue({ id: "audit-1" });
    startAgentCommandPlan.mockResolvedValue({ id: "plan-1", caseId: "case-1", version: 1 });
    finishAgentCommandPlan.mockResolvedValue(undefined);
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
      details: { durationMs: 12, confidence: 0.8, missingDataCount: 0 },
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

  it("сохраняет bounded plan и завершает его после успешной typed capability", async () => {
    const capability = new AuditedAgentCommandCapability(
      { execute },
      { writeAudit },
      () => 100,
      { startAgentCommandPlan, finishAgentCommandPlan },
      () => new Date("2026-08-13T10:00:00.000Z"),
    );

    await capability.execute(createAgentExecutionContext(trusted(), {
      selection: { projectId: "project-1", specificationId: "spec-1" },
      correlationId: "correlation-plan-1",
    }), {
      commandKey: "SUMMARY",
      context: { projectId: "project-1", specificationId: "spec-1" },
    });

    expect(startAgentCommandPlan).toHaveBeenCalledWith("subject-1", {
      projectId: "project-1",
      commandKey: "SUMMARY",
      correlationId: "correlation-plan-1",
      selection: { projectId: "project-1", specificationId: "spec-1" },
      actorDisplayName: "Аналитик",
      authorizationVersion: 7,
      roleAssignmentSnapshot: ["assignment-1"],
      occurredAt: "2026-08-13T10:00:00.000Z",
    });
    expect(finishAgentCommandPlan).toHaveBeenCalledWith("subject-1", expect.objectContaining({
      id: "plan-1",
      caseId: "case-1",
      projectId: "project-1",
      correlationId: "correlation-plan-1",
      status: "SUCCEEDED",
      actorDisplayName: "Аналитик",
    }));
  });

  it("передаёт безопасный versioned snapshot для истории аналитического ответа", async () => {
    execute.mockResolvedValue({
      responseType: "ANALYSIS",
      title: "Анализ позиции",
      summary: "Остаточный дефицит 12 EA.",
      citations: [],
      missingData: [],
      confidence: 0.9,
      requiresHumanReview: true,
      negativeEvidence: "NOT_EMPTY",
      generatedAt: "2026-08-13T10:00:00.000Z",
      analysis: {
        executiveSummary: "Остаточный дефицит 12 EA.",
        confidence: 0.9,
        requiresHumanReview: true,
        generatedAt: "2026-08-13T10:00:00.000Z",
        citations: [{
          sourceSystem: "SAP",
          entityId: "SAP-DEMO-0001",
          versionOrSnapshot: "sap-v1",
          observedAt: "2026-08-13T09:00:00.000Z",
          clauseId: null,
        }],
        forecast: { selectedModel: { modelVersion: "linear-trend-v1" } },
        recommendation: { nextAction: "Передать вариант специалисту." },
        technicalTrace: {
          datasetVersion: "1.0.0-DEMO",
          semanticRegistryVersion: "semantic-registry-1.0.0",
        },
      },
    });
    const capability = new AuditedAgentCommandCapability(
      { execute },
      { writeAudit },
      () => 100,
      { startAgentCommandPlan, finishAgentCommandPlan },
      () => new Date("2026-08-13T10:00:00.000Z"),
    );

    await capability.execute(createAgentExecutionContext(trusted(), {
      selection: { projectId: "project-1", positionId: "position-1" },
      correlationId: "correlation-analysis-history",
    }), {
      commandKey: "ANALYSIS",
      context: { projectId: "project-1", positionId: "position-1" },
    });

    expect(finishAgentCommandPlan).toHaveBeenCalledWith("subject-1", expect.objectContaining({
      status: "SUCCEEDED",
      analysisHistory: {
        summary: "Остаточный дефицит 12 EA.",
        confidence: 0.9,
        requiresHumanReview: true,
        generatedAt: "2026-08-13T10:00:00.000Z",
        datasetVersion: "1.0.0-DEMO",
        semanticRegistryVersion: "semantic-registry-1.0.0",
        forecastModelVersion: "linear-trend-v1",
        recommendation: "Передать вариант специалисту.",
        citations: [expect.objectContaining({ sourceSystem: "SAP" })],
      },
    }));
  });

  it("фиксирует безопасный отказ плана без закрытой причины ошибки", async () => {
    execute.mockRejectedValue(Object.assign(new Error("секретная причина"), { code: "SOURCE_DOWN" }));
    const capability = new AuditedAgentCommandCapability(
      { execute },
      { writeAudit },
      () => 100,
      { startAgentCommandPlan, finishAgentCommandPlan },
      () => new Date("2026-08-13T10:00:00.000Z"),
    );

    await expect(capability.execute(createAgentExecutionContext(trusted(), {
      selection: { projectId: "project-1" },
      correlationId: "correlation-plan-failed",
    }), {
      commandKey: "RISKS",
      context: { projectId: "project-1" },
    })).rejects.toThrow("секретная причина");

    expect(finishAgentCommandPlan).toHaveBeenCalledWith("subject-1", expect.objectContaining({
      status: "FAILED",
      actorDisplayName: "Аналитик",
      safeErrorCode: "SOURCE_DOWN",
    }));
    expect(JSON.stringify(finishAgentCommandPlan.mock.calls)).not.toContain("секретная причина");
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

vi.mock("server-only", () => ({}));

import {
  isUserVisibleAgentMessage,
  serializeAgentMessage,
} from "@/app/api/agent/_shared";

function bundle(role = "assistant") {
  return {
    message: {
      id: "message-1",
      threadId: "thread-1",
      userId: "demo-user-001",
      role,
      content: "Материал доступен в количестве 12 шт.",
      structuredOutput: {
        facts: ["internal"],
        recommendations: ["internal"],
        confidence: 0.91,
        requiresHumanReview: false,
        toolCalls: [{ tool: "sap.getMaterialStock", outcome: "OK", durationMs: 10 }],
      },
      promptVersion: "secret-system-prompt-v9",
      createdAt: "2026-08-12T10:00:00.000Z",
      updatedAt: "2026-08-12T10:00:00.000Z",
      createdBy: "demo-user-001",
      version: 1,
    },
    citations: [
      {
        id: "citation-1",
        messageId: "message-1",
        userId: "demo-user-001",
        sourceSystem: "SAP",
        entityId: "SAP-DEMO-0001",
        versionOrSnapshot: "2026-08-12",
        clauseId: null,
        createdAt: "2026-08-12T10:00:00.000Z",
        updatedAt: "2026-08-12T10:00:00.000Z",
        createdBy: "demo-user-001",
        version: 1,
      },
    ],
  };
}

describe("agent message serialization boundary", () => {
  it("never exposes tool calls, raw output, facts or prompt metadata to the user", () => {
    const serialized = serializeAgentMessage(bundle());
    const json = JSON.stringify(serialized);

    expect(serialized).toMatchObject({
      content: "Материал доступен в количестве 12 шт.",
      structuredOutput: { confidence: 0.91, requiresHumanReview: false },
      citations: [expect.objectContaining({ sourceSystem: "SAP", entityId: "SAP-DEMO-0001" })],
    });
    expect(json).not.toContain("toolCalls");
    expect(json).not.toContain("sap.getMaterialStock");
    expect(json).not.toContain("secret-system-prompt-v9");
    expect(json).not.toContain("facts");
    expect(json).not.toContain("recommendations");
  });

  it("filters service messages before they reach chat", () => {
    expect(isUserVisibleAgentMessage(bundle("assistant"))).toBe(true);
    expect(isUserVisibleAgentMessage(bundle("user"))).toBe(true);
    expect(isUserVisibleAgentMessage(bundle("system"))).toBe(false);
    expect(isUserVisibleAgentMessage(bundle("tool"))).toBe(false);
  });

  it("restores a saved public analytical command without restoring technical payload", () => {
    const saved = bundle();
    (saved.message as { structuredOutput: Record<string, unknown> | null }).structuredOutput = {
      schemaVersion: "mtr-agent-command-public-v1",
      messageId: "analysis-1",
      responseLabel: "Анализ позиции",
      statusLabel: "Доступен частичный результат",
      answer: "Остаточный дефицит 12 EA.",
      riskLabel: null,
      confidence: 0.9,
      requiresHumanReview: true,
      technicalContentRemoved: false,
      generatedAt: "2026-08-13T10:00:00.000Z",
      sources: [{
        sourceLabel: "SAP S/4HANA",
        entityId: "closed-material",
        versionOrSnapshot: "closed-snapshot",
        clauseId: null,
        freshnessLabel: "Актуальные данные",
        availabilityLabel: "Доступно",
        href: "/materials/closed-material",
        canOpen: true,
      }],
      analysis: {
        executiveSummary: "Остаточный дефицит 12 EA.",
        facts: ["Потребность: 20 EA."],
        findings: ["Доступно: 8 EA."],
        drivers: [{
          title: "Рост расхода",
          status: "Поддержана данными",
          relationship: "Связанный фактор",
          contributionPercent: 72,
        }],
        forecast: null,
        scenarios: [{
          kind: "Проект закупки",
          score: 85,
          feasible: true,
          coveredQuantity: 20,
          remainingShortage: 0,
        }],
        recommendation: "Передать вариант специалисту.",
        limitations: ["Синтетический набор."],
        nextActions: ["Обновить расчёт."],
        technicalTrace: { secret: "must-not-return" },
      },
      learningProvenance: {
        projectId: "demo-project-001",
        modelVersion: "deterministic-runtime-v1",
        evidenceVersion: "private-evidence-graph",
      },
      toolCalls: [{ tool: "sap.getMaterialStock", outcome: "OK", durationMs: 10 }],
    };

    const serialized = serializeAgentMessage(saved, []);
    const json = JSON.stringify(serialized);

    expect(serialized.structuredOutput).toMatchObject({
      schemaVersion: "mtr-agent-command-public-v1",
      responseLabel: "Анализ позиции",
      analysis: {
        facts: ["Потребность: 20 EA."],
        scenarios: [expect.objectContaining({ kind: "Проект закупки" })],
      },
      sources: [],
    });
    expect(json).not.toMatch(/technicalTrace|must-not-return|toolCalls|sap\.getMaterialStock|closed-material|learningProvenance|private-evidence-graph/u);
  });

  it("projects a privileged action card without internal user or assignment identifiers", () => {
    const saved = bundle();
    (saved.message as { structuredOutput: Record<string, unknown> | null }).structuredOutput = {
      schemaVersion: "agent-privileged-action-v1",
      actionProposal: {
        id: "action-public-1",
        actionType: "CHANGE_PROJECT_ROLE",
        summary: "Изменить роль сотрудника",
        consequences: ["Активные сессии будут отозваны."],
        parameters: {
          targetUserId: "demo-analyst-001",
          currentAssignmentId: "assign-secret-1",
          projectId: "demo-project-001",
          fromRoleKey: "MTR_ANALYST",
          toRoleKey: "MTR_EXPERT",
          impact: {
            targetDisplayName: "Аналитик МТР",
            targetLogin: "analyst",
            currentStatus: "Активен",
            currentRoles: ["Аналитик МТР · Демонстрационный проект"],
            projectLabel: "Демонстрационный проект",
            newState: "Назначить роль «Эксперт МТР»",
            affectedSessions: 1,
            affectedAssignments: 1,
            segregationOfDuties: "PASS",
            lastAdministratorRisk: false,
            lastProjectManagerRisk: false,
          },
        },
        status: "PROPOSED",
        expiresAt: "2026-08-13T12:30:00.000Z",
        result: null,
      },
      clarification: null,
      internalTrace: { targetUserId: "demo-analyst-001" },
    };

    const serialized = serializeAgentMessage(saved, []);
    const json = JSON.stringify(serialized);

    expect(serialized.structuredOutput).toMatchObject({
      schemaVersion: "agent-privileged-action-v1",
      actionProposal: {
        actionType: "CHANGE_PROJECT_ROLE",
        parameters: {
          impact: {
            targetDisplayName: "Аналитик МТР",
            targetLogin: "analyst",
          },
        },
      },
    });
    expect(json).not.toMatch(/demo-analyst-001|assign-secret-1|demo-project-001|fromRoleKey|toRoleKey|internalTrace/u);
  });
});

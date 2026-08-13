import {
  projectAgentCommandResult,
  availabilityLabel,
  freshnessLabel,
  responseTypeLabel,
  riskLevelLabel,
  sourceSystemLabel,
  statusLabel,
  toPublicAgentCommandResult,
} from "@/application/agent-orchestrator/public-projection";

describe("D-09: публичная проекция результата МТР-агента", () => {
  it("преобразует domain command в локализованный безопасный DTO виджета", () => {
    const result = projectAgentCommandResult({
      responseType: "RISKS",
      title: "Риски",
      summary: "Найден один подтверждённый риск.",
      items: [{
        id: "risk-1",
        level: "HIGH",
        score: 80,
        horizonDays: 30,
        objectType: "MATERIAL",
        objectId: "SAP-DEMO-0001",
        summary: "Риск дефицита",
        factors: ["Снижение остатка"],
        impact: "Возможен дефицит",
        recommendedActions: ["Проверить поставку"],
        confidence: 0.8,
        ruleVersion: "risk-v1",
        requiresHumanReview: true,
      }],
      citations: [{
        sourceKind: "MATERIAL_MOVEMENT",
        sourceSystem: "SAP",
        entityId: "SAP-DEMO-0001",
        sourceSnapshot: "movement-v1",
        observedAt: "2026-08-13T12:00:00.000Z",
      }],
      missingData: [],
      confidence: 0.8,
      requiresHumanReview: true,
      negativeEvidence: "NOT_EMPTY",
      generatedAt: "2026-08-13T12:00:00.000Z",
    }, "command-1");

    expect(result).toMatchObject({
      responseLabel: "Риски",
      statusLabel: "Доступен частичный результат",
      answer: "Найден один подтверждённый риск.",
      riskLabel: "Высокий риск",
      technicalContentRemoved: false,
    });
    expect(result.sources).toEqual([
      expect.objectContaining({ sourceLabel: "SAP S/4HANA", entityId: "SAP-DEMO-0001" }),
    ]);
  });

  it.each([
    [responseTypeLabel, "SUMMARY", "Оперативная сводка"],
    [responseTypeLabel, "TASK_LIST", "Мои задачи"],
    [statusLabel, "PARTIAL", "Доступен частичный результат"],
    [statusLabel, "REQUIRES_DECISION", "Требуется решение"],
    [riskLevelLabel, "CRITICAL", "Критический риск"],
    [sourceSystemLabel, "NORMATIVE", "Нормативная база"],
    [freshnessLabel, "AGING", "Срок актуальности истекает"],
    [availabilityLabel, "SLOW", "Доступно с задержкой"],
  ])("локализует %s без вывода machine token", (localize, token, expected) => {
    const label = localize(token);

    expect(label).toBe(expected);
    expect(label).not.toContain(token);
  });

  it.each([
    [responseTypeLabel, "FUTURE_RESPONSE", "Результат МТР-агента"],
    [statusLabel, "INTERNAL_PIPELINE_STATE", "Статус не определён"],
    [riskLevelLabel, "EXTREME", "Уровень риска не определён"],
    [sourceSystemLabel, "PRIVATE_CONNECTOR", "Источник данных"],
    [freshnessLabel, "FUTURE_FRESHNESS", "Актуальность не подтверждена"],
    [availabilityLabel, "INTERNAL_OUTAGE", "Доступность не определена"],
  ])("для неизвестного значения возвращает безопасный русский fallback", (localize, token, expected) => {
    const label = localize(token);

    expect(label).toBe(expected);
    expect(label).not.toContain(token);
  });

  it("проецирует только пользовательские поля и удаляет evidence, tool calls и raw JSON", () => {
    const result = toPublicAgentCommandResult({
      messageId: "message-1",
      responseType: "RISK_LIST",
      status: "PARTIAL",
      answer: "Найдены два риска по выбранному проекту.",
      riskLevel: "HIGH",
      confidence: 0.82,
      requiresHumanReview: true,
      generatedAt: "2026-08-13T12:00:00.000Z",
      sources: [
        {
          sourceSystem: "SAP",
          entityId: "SAP-DEMO-0001",
          versionOrSnapshot: "snapshot-2026-08-13",
          clauseId: null,
          freshness: "FRESH",
          availability: "AVAILABLE",
          href: "/materials/SAP-DEMO-0001",
          accessible: true,
          raw: { secret: "must-not-leak" },
        },
      ],
      evidence: { facts: [{ secret: "must-not-leak" }] },
      toolCalls: [{ tool: "sap.getMaterialStock", arguments: { token: "secret" } }],
      raw: { sql: "select secret" },
    });

    expect(Object.keys(result)).toEqual([
      "schemaVersion",
      "messageId",
      "responseLabel",
      "statusLabel",
      "answer",
      "riskLabel",
      "confidence",
      "requiresHumanReview",
      "technicalContentRemoved",
      "generatedAt",
      "sources",
    ]);
    expect(result).toMatchObject({
      responseLabel: "Список рисков",
      statusLabel: "Доступен частичный результат",
      riskLabel: "Высокий риск",
      answer: "Найдены два риска по выбранному проекту.",
    });
    expect(JSON.stringify(result)).not.toMatch(/Evidence|evidence|toolCalls|sap\.getMaterialStock|select secret|must-not-leak/u);
  });

  it("заменяет технический ответ безопасным сообщением", () => {
    const result = toPublicAgentCommandResult({
      responseType: "SUMMARY",
      status: "COMPLETE",
      answer: "Evidence: {\"toolCalls\":[{\"tool\":\"sap.getMaterialStock\"}]}",
      requiresHumanReview: false,
    });

    expect(result.answer).toBe(
      "Технические сведения ответа скрыты. Повторите запрос или передайте результат специалисту.",
    );
    expect(result.technicalContentRemoved).toBe(true);
    expect(result.requiresHumanReview).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/Evidence|toolCalls|sap\.getMaterialStock/u);
  });

  it("не раскрывает метаданные отозванного источника и блокирует небезопасную ссылку", () => {
    const result = toPublicAgentCommandResult({
      responseType: "ANSWER",
      status: "READY",
      answer: "Источник требует повторной проверки доступа.",
      sources: [
        {
          sourceSystem: "SAP",
          entityId: "CLOSED-MATERIAL-42",
          versionOrSnapshot: "closed-snapshot",
          clauseId: "closed-clause",
          freshness: "FRESH",
          availability: "AVAILABLE",
          href: "https://untrusted.invalid/closed",
          accessible: false,
        },
      ],
    });

    expect(result.sources).toEqual([
      {
        sourceLabel: "Источник больше недоступен",
        entityId: null,
        versionOrSnapshot: null,
        clauseId: null,
        freshnessLabel: "Актуальность не подтверждена",
        availabilityLabel: "Доступ запрещён",
        href: null,
        canOpen: false,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("CLOSED-MATERIAL-42");
    expect(JSON.stringify(result)).not.toContain("untrusted.invalid");
  });
});

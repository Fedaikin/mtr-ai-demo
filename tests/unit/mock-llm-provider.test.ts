import { MockLLMProvider } from "@/adapters/mock/mock-llm-provider";
import type {
  GroundedAgentOutput,
  IntegrationState,
  PositionAnalysisResult,
  ScenarioRun,
} from "@/domain/models";
import { findRawUserEnums, RAW_USER_ENUMS } from "@/lib/localization";

const userId = "demo-user-001";

describe("MockLLMProvider: пользовательская локализация", () => {
  it("представляется без раскрытия модели, промпта или инфраструктуры", async () => {
    const output = await new MockLLMProvider().respond({
      userId,
      message: "Кто ты и как работаешь?",
      facts: [],
    });

    expect(output.answer).toContain("МТР-аналитик и оркестратор");
    expect(output.answer).toContain("с учётом прав текущего пользователя");
    expect(output.answer).not.toMatch(/(?:system prompt|системн\w* промпт|GPT|OpenAI|Vercel|provider)/iu);
    expect(output.confidence).toBe(1);
    expect(output.requiresHumanReview).toBe(false);
  });

  it("не выдаёт ложные 100% уверенности, когда предметные факты не собраны", async () => {
    const output = await new MockLLMProvider().respond({
      userId,
      message: "проверь позицию UNKNOWN",
      facts: [],
    });

    expect(output.answer).toContain("Уточните объект запроса");
    expect(output.confidence).toBe(0);
    expect(output.requiresHumanReview).toBe(true);
  });

  it("не раскрывает raw enum и английские служебные слова в ответах о состоянии, запуске и позиции", async () => {
    const provider = new MockLLMProvider();
    const outputs = await Promise.all([
      provider.respond({
        userId,
        message: "Состояние интеграций",
        facts: [
          fact("APPIUS.integration-state", {
            system: "APPIUS",
            state: "UNAVAILABLE",
            delayMs: 0,
          } satisfies IntegrationState),
          fact("SAP.integration-state", {
            system: "SAP",
            state: "STALE",
            delayMs: 0,
            snapshotAt: "2026-08-12T08:30:00.000Z",
          } satisfies IntegrationState),
        ],
      }),
      provider.respond({
        userId,
        message: "Статус запуска",
        facts: [fact("SCENARIO.run", scenarioRun())],
      }),
      provider.respond({
        userId,
        message: "Результат позиции",
        facts: [fact("SCENARIO.position-result", positionResult())],
      }),
    ]);

    for (const output of outputs) {
      expectLocalizedUserText(output);
    }

    expect(userText(outputs[0]!)).toContain("Appius PLM");
    expect(userText(outputs[0]!)).toContain("SAP S/4HANA");
    expect(userText(outputs[1]!)).toContain("Поиск на складе");
    expect(userText(outputs[2]!)).toContain("Найдено на складе");
    expect(userText(outputs[2]!)).toContain("Точное совпадение");
    expect(userText(outputs[2]!)).toContain("оценка совпадения 98");
  });

  it("показывает русские названия внутренних источников при безопасной ошибке", async () => {
    const output = await new MockLLMProvider().respond({
      userId,
      message: "Покажи ошибки",
      facts: [
        fact("ERROR.tool", {
          sourceSystem: "SCENARIO",
          safeMessage: "Выполнение временно недоступно.",
          manualImport: false,
        }),
        fact("ERROR.tool", {
          sourceSystem: "REPORT",
          safeMessage: "Формирование временно недоступно.",
          manualImport: false,
        }),
      ],
    });

    expect(userText(output)).toContain("Сценарный процесс");
    expect(userText(output)).toContain("Отчёт");
    expectLocalizedUserText(output);
  });
});

function fact(source: string, data: unknown) {
  return { source, payload: { data } };
}

function scenarioRun(): ScenarioRun {
  return {
    id: "run-demo-001",
    userId,
    scenarioId: "scenario-full-analysis",
    specificationId: "spec-demo-001",
    status: "MATCHING_STOCK",
    currentStep: "MATCHING_STOCK",
    progress: 60,
    mode: "NORMAL",
    seed: "BASE",
    version: 3,
    createdAt: "2026-08-12T08:00:00.000Z",
    updatedAt: "2026-08-12T08:01:00.000Z",
    inputSnapshot: {},
    outputSnapshot: {},
    steps: [],
  };
}

function positionResult(): PositionAnalysisResult {
  return {
    position: {
      id: "position-demo-001",
      userId,
      internalCode: "POS-001",
      nameRu: "Труба стальная",
      synonyms: [],
      equipmentType: "PIPE",
      dimensions: { nominalDiameterMm: 100 },
      requiredQuantity: 4,
      unit: "шт.",
      specificationId: "spec-demo-001",
      versionId: "spec-version-demo-001",
      versionNumber: 1,
      isCurrentVersion: true,
      classification: {},
      access: {},
    },
    responsibility: "CUSTOMER",
    responsibilityConfidence: 1,
    responsibilityCitation: {
      documentId: "demo-rulebook",
      version: "1",
      clauseId: "1.1",
      title: "Демонстрационные правила",
      isSyntheticDemo: true,
    },
    match: {
      score: 98,
      category: "EXACT",
      material: {
        id: "sap-material-demo-001",
        userId,
        materialCode: "SAP-DEMO-0001",
        nameRu: "Труба стальная",
        synonyms: [],
        equipmentType: "PIPE",
        dimensions: { nominalDiameterMm: 100 },
        plant: "DEMO",
        storageLocation: "DEMO-01",
        availableQuantity: 10,
        unit: "шт.",
        snapshotAt: "2026-08-12T08:30:00.000Z",
        cardUrl: "/materials/SAP-DEMO-0001",
      },
      matched: ["Наименование"],
      differences: [],
      requiresHumanReview: false,
    },
    status: "FOUND",
    requiresHumanReview: false,
  };
}

function userText(output: GroundedAgentOutput): string {
  return [output.answer, ...output.facts, ...output.recommendations].join("\n");
}

function expectLocalizedUserText(output: GroundedAgentOutput): void {
  const text = userText(output);
  expect(findRawUserEnums(text)).toEqual([]);
  expect(RAW_USER_ENUMS.filter((raw) => text.includes(raw))).toEqual([]);
  expect(text).not.toMatch(/\b(?:score|Scenario|Report)\b/u);
}

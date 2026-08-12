import { describe, expect, it } from "vitest";

import type { PositionAnalysisResult } from "@/domain/models";
import { buildPositionAnalogueViews } from "@/lib/report-analogues";

describe("представление вариантов аналогов", () => {
  it("показывает планы отдельно от компонентов и не скрывает отклонения или дефицит", () => {
    const input = analysisResult();
    const allocations = input.analogueCoverage?.allocations ?? [];
    if (!input.analogueCoverage) throw new Error("coverage fixture is required");
    input.analogueCoverage.primaryPlan = {
      coveredQuantity: 3,
      complete: false,
      allocations,
    };
    input.analogueCoverage.alternativePlans = [{
      coveredQuantity: 2,
      complete: false,
      allocations: allocations.slice(0, 1),
    }];

    const result = buildPositionAnalogueViews([input]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      reason: "Прямое совпадение в SAP S/4HANA не найдено.",
      requiredQuantity: 5,
      coveredQuantity: 3,
      shortageQuantity: 2,
      combinedCoverage: true,
      complete: false,
    });
    expect(result[0]?.plans).toHaveLength(2);
    expect(result[0]?.primary).toMatchObject({
      kind: "PRIMARY",
      coveredQuantity: 3,
      shortageQuantity: 2,
      combinedCoverage: true,
    });
    expect(result[0]?.primary?.components.map((component) => component.materialCode)).toEqual([
      "SAP-DEMO-BEST",
      "SAP-DEMO-REVIEW",
    ]);
    expect(result[0]?.primary?.components[0]).toMatchObject({
      componentIndex: 1,
      materialCode: "SAP-DEMO-BEST",
      score: 100,
      verdictLabel: "Подходит",
      remainingAfterReservation: 0,
    });
    expect(result[0]?.alternatives[0]).toMatchObject({
      kind: "ALTERNATIVE",
      coveredQuantity: 2,
      shortageQuantity: 3,
      combinedCoverage: false,
    });
    expect(result[0]?.alternatives[0]?.components[0]).toMatchObject({
      materialCode: "SAP-DEMO-REVIEW",
      score: 50,
      verdictLabel: "Требуется экспертная проверка",
    });
    expect(result[0]?.alternatives[0]?.components[0]).not.toHaveProperty("kind");
    expect(result[0]?.alternatives[0]?.components[0]?.deviations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        characteristicLabel: "Стандарт",
        required: "ГОСТ-ДЕМО-А",
        available: "ГОСТ-ДЕМО-Б",
        differs: true,
      }),
    ]));
    expect(result[0]?.alternatives[0]?.components[0]?.explanation).toContain("они показаны в таблице и не скрыты");
  });

  it("читает прежний формат покрытия как единственный основной план", () => {
    const [view] = buildPositionAnalogueViews([analysisResult()]);

    expect(view?.plans).toHaveLength(1);
    expect(view?.primary?.kind).toBe("PRIMARY");
    expect(view?.primary?.components).toHaveLength(2);
    expect(view?.alternatives).toEqual([]);
  });

  it("не скрывает отрицательный результат поиска аналогов для прямого дефицита", () => {
    const cases = [
      ["position-009", "APP-DEMO-009", 80, 60, "NO_APPLICABLE_RULE", 0],
      ["position-012", "APP-DEMO-012", 6, 2, "NO_ELIGIBLE_CANDIDATE", 1],
      ["position-016", "APP-DEMO-016", 10, 7, "NO_ELIGIBLE_CANDIDATE", 1],
      ["position-018", "APP-DEMO-018", 2, 1, "NO_ELIGIBLE_CANDIDATE", 1],
    ] as const;
    const results = cases.map(([id, code, required, direct, outcome, ruleCount]) => {
      const result = analysisResult();
      result.position.id = id;
      result.position.internalCode = code;
      result.position.requiredQuantity = required;
      result.match.category = "LIKELY";
      result.match.material = result.analogueCoverage!.allocations[0]!.material;
      result.match.material.availableQuantity = direct;
      result.analogueSearch = {
        directCoveredQuantity: direct,
        shortageQuantity: required - direct,
        outcome,
        ruleCount,
      };
      delete result.analogueCoverage;
      return result;
    });

    const views = buildPositionAnalogueViews(results);

    expect(views.map((view) => view.positionId)).toEqual(cases.map(([id]) => id));
    for (const [id, , required, direct, outcome, ruleCount] of cases) {
      expect(views.find((view) => view.positionId === id)).toMatchObject({
        searchOutcome: outcome,
        searchOutcomeLabel: outcome === "NO_APPLICABLE_RULE"
          ? "Нет применимого нормативного правила"
          : "Допустимый аналог не найден",
        searchRuleCount: ruleCount,
        directCoveredQuantity: direct,
        analogueCoveredQuantity: 0,
        requiredQuantity: required,
        coveredQuantity: direct,
        shortageQuantity: required - direct,
        complete: false,
        plans: [],
      });
      expect(views.find((view) => view.positionId === id)?.combinedCoverageLabel).toContain(
        `прямой материал покрывает ${direct} из ${required}`,
      );
    }
  });

  it("разделяет прямое и аналоговое покрытие для полного и частичного результата", () => {
    const full = analysisResult();
    full.position.id = "position-full";
    full.position.internalCode = "APP-DEMO-FULL";
    full.position.requiredQuantity = 10;
    full.analogueSearch = {
      directCoveredQuantity: 7,
      shortageQuantity: 3,
      outcome: "ALLOCATED",
      ruleCount: 1,
    };
    full.analogueCoverage = {
      ...full.analogueCoverage!,
      requiredQuantity: 10,
      directCoveredQuantity: 7,
      coveredQuantity: 10,
      complete: true,
      primaryPlan: {
        coveredQuantity: 10,
        complete: true,
        allocations: full.analogueCoverage!.allocations,
      },
    };

    const partial = structuredClone(full);
    partial.position.id = "position-partial";
    partial.position.internalCode = "APP-DEMO-PARTIAL";
    partial.analogueCoverage!.coveredQuantity = 8;
    partial.analogueCoverage!.complete = false;
    partial.analogueCoverage!.primaryPlan!.coveredQuantity = 8;
    partial.analogueCoverage!.primaryPlan!.complete = false;

    const views = buildPositionAnalogueViews([full, partial]);

    expect(views.find((view) => view.positionId === "position-full")).toMatchObject({
      searchOutcome: "ALLOCATED",
      searchOutcomeLabel: "Аналог распределён",
      directCoveredQuantity: 7,
      analogueCoveredQuantity: 3,
      coveredQuantity: 10,
      shortageQuantity: 0,
      complete: true,
    });
    expect(views.find((view) => view.positionId === "position-partial")).toMatchObject({
      directCoveredQuantity: 7,
      analogueCoveredQuantity: 1,
      coveredQuantity: 8,
      shortageQuantity: 2,
      complete: false,
    });
  });
});

function analysisResult(): PositionAnalysisResult {
  const position = {
    id: "position-demo",
    userId: "demo-user-001",
    internalCode: "APP-DEMO-001",
    nameRu: "Требуемый демонстрационный насос",
    synonyms: [],
    equipmentType: "PUMP",
    standard: "ГОСТ-ДЕМО-А",
    materialGrade: "СТАЛЬ-ДЕМО-А",
    dimensions: {},
    requiredQuantity: 5,
    unit: "шт.",
    specificationId: "spec-demo",
    versionId: "spec-demo-v1",
    versionNumber: 1,
    isCurrentVersion: true,
    classification: {},
    access: {},
  };
  const citation = {
    documentId: "ПРАВИЛО-ДЕМО-1",
    version: "1.0",
    clauseId: "4.2",
    title: "Демонстрационное правило",
    isSyntheticDemo: true as const,
  };
  const material = (code: string, availableQuantity: number) => ({
    id: code,
    userId: "demo-user-001",
    materialCode: code,
    nameRu: `Материал ${code}`,
    synonyms: [],
    equipmentType: "PUMP",
    dimensions: {},
    plant: "ЗАВОД-ДЕМО",
    storageLocation: "СКЛАД-ДЕМО",
    availableQuantity,
    unit: "шт.",
    snapshotAt: "2026-08-12T00:00:00.000Z",
    cardUrl: `/materials/${code}`,
  });
  return {
    position,
    responsibility: "CUSTOMER",
    responsibilityConfidence: 1,
    responsibilityCitation: citation,
    match: {
      score: 0,
      category: "NO_MATCH",
      material: null,
      matched: [],
      differences: ["Прямой материал не найден"],
      requiresHumanReview: false,
    },
    analogueCoverage: {
      requiredQuantity: 5,
      coveredQuantity: 3,
      unit: "шт.",
      complete: false,
      allocations: [
        {
          material: material("SAP-DEMO-REVIEW", 2),
          allocatedQuantity: 2,
          remainingAfterReservation: 0,
          deviations: [
            { characteristic: "standard", required: "ГОСТ-ДЕМО-А", available: "ГОСТ-ДЕМО-Б", deviation: "есть" },
            { characteristic: "materialGrade", required: "СТАЛЬ-ДЕМО-А", available: "СТАЛЬ-ДЕМО-А", deviation: "нет" },
          ],
          verdict: "REVIEW",
          citation,
        },
        {
          material: material("SAP-DEMO-BEST", 1),
          allocatedQuantity: 1,
          remainingAfterReservation: 0,
          deviations: [
            { characteristic: "standard", required: "ГОСТ-ДЕМО-А", available: "ГОСТ-ДЕМО-А", deviation: "нет" },
            { characteristic: "materialGrade", required: "СТАЛЬ-ДЕМО-А", available: "СТАЛЬ-ДЕМО-А", deviation: "нет" },
          ],
          verdict: "SUITABLE",
          citation,
        },
      ],
    },
    status: "INSUFFICIENT",
    requiresHumanReview: true,
  };
}

import type {
  AnalyticalRecommendation,
  AnalyticalScenarioRun,
  VerificationResult,
} from "@/domain/agent/analytics/artifacts";

export function createAnalyticalRecommendation(
  scenario: AnalyticalScenarioRun,
  verification: VerificationResult,
): AnalyticalRecommendation | null {
  if (!verification.valid || !scenario.recommendedAlternativeId) return null;
  const option = scenario.alternatives.find(
    (alternative) => alternative.id === scenario.recommendedAlternativeId,
  );
  if (!option?.feasible) return null;

  return {
    objective: "Закрыть подтверждённую потребность без нарушения нормативных ограничений.",
    optionId: option.id,
    rationaleFindingIds: option.evidenceNodeIds,
    expectedEffect: [
      {
        metric: "RESIDUAL_DEFICIT",
        from: scenario.requiredQuantity,
        to: option.remainingShortage,
        unit: scenario.unit,
      },
      {
        metric: "TIME_TO_AVAILABILITY",
        from: 0,
        to: option.maxLeadTimeDays,
        unit: "DAYS",
      },
    ],
    assumptions: ["Снимки источников остаются актуальными до решения человека."],
    constraints: ["Вариант должен сохранить нормативную допустимость и единицу измерения."],
    residualRisks:
      option.maxLeadTimeDays > 0
        ? ["Фактический срок доступности может измениться после обновления источника."]
        : [],
    confidence: verification.confidenceCeiling,
    requiresHumanReview: true,
    nextAction: "Передать вариант специалисту для проверки и решения.",
    autonomyLevel: "A2",
    scenarioRunId: scenario.id,
    verifierPassed: true,
  };
}

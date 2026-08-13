import { describe, expect, it } from "vitest";

import { calculateCoverage } from "@/application/agent-orchestrator/analytics/coverage-engine";
import { createAnalyticalRecommendation } from "@/application/agent-orchestrator/analytics/recommendation-engine";
import { evaluateScenarios } from "@/application/agent-orchestrator/analytics/scenario-engine";
import { analyzeTrend } from "@/application/agent-orchestrator/analytics/trend-anomaly-engine";
import type { DataQualityResult } from "@/domain/agent/analytics/quality";

const COMPLETE_QUALITY: DataQualityResult = {
  availability: "COMPLETE",
  completeness: 1,
  freshness: "FRESH",
  confidenceCeiling: 0.88,
  sourceAssessments: [],
  issues: [],
  requiresHumanReview: false,
};

describe("coverage, trend and recommendation engines", () => {
  it("prevents stock double counting and separates every quantity dimension", () => {
    const result = calculateCoverage({
      requiredQuantity: 20,
      unit: "EA",
      directMaterialCode: "DIRECT-1",
      confirmedInboundQuantity: 3,
      averageDailyConsumption: 2,
      analogueMaterialCodes: ["DIRECT-1", "ALT-1", "ALT-1"],
      stock: [
        {
          materialCode: "DIRECT-1",
          physicalQuantity: 12,
          reservedQuantity: 2,
          quarantinedQuantity: 1,
          unit: "EA",
          evidenceNodeId: "stock-direct",
        },
        {
          materialCode: "ALT-1",
          physicalQuantity: 8,
          reservedQuantity: 1,
          quarantinedQuantity: 0,
          unit: "EA",
          evidenceNodeId: "stock-alt",
        },
      ],
    });

    expect(result).toMatchObject({
      physicalQuantity: 20,
      reservedQuantity: 3,
      quarantinedQuantity: 1,
      availableQuantity: 16,
      directCoverageQuantity: 9,
      analogueCoverageQuantity: 7,
      confirmedInboundQuantity: 3,
      residualDeficitQuantity: 1,
      coverageHorizonDays: 8,
    });
    expect(result.allocations).toEqual([
      { materialCode: "DIRECT-1", quantity: 9, source: "DIRECT" },
      { materialCode: "ALT-1", quantity: 7, source: "ANALOGUE" },
    ]);
  });

  it("uses a robust baseline and reports missing weeks separately from an anomaly", () => {
    const start = Date.parse("2026-05-04T00:00:00.000Z");
    const observations = [10, 11, 9, 10, 10, 11, 9, 50].map((quantity, index) => ({
      weekStart: new Date(start + index * 7 * 24 * 60 * 60_000).toISOString(),
      quantity,
      unit: "EA",
      evidenceNodeId: `week-${index}`,
    }));
    const result = analyzeTrend(observations);

    expect(result).toMatchObject({
      status: "COMPLETE",
      direction: "UP",
      baselineMedian: 10,
      currentValue: 50,
      relativeChange: 4,
      anomaly: "SPIKE",
      missingWeekCount: 0,
    });
    expect(result.robustZScore).toBeGreaterThan(3.5);

    const withGap = analyzeTrend([
      ...observations.slice(0, 7),
      { ...observations[7], weekStart: "2026-07-06T00:00:00.000Z" },
    ]);
    expect(withGap.missingWeekCount).toBe(2);
  });

  it("creates a recommendation only from a verified feasible scenario", () => {
    const scenario = evaluateScenarios({
      id: "scenario-recommend",
      datasetVersion: "g1-vertical-v1",
      createdAt: "2026-08-11T00:00:00.000Z",
      requiredQuantity: 10,
      unit: "EA",
      directAvailableQuantity: 10,
      candidates: [],
      procurementLeadTimeDays: 30,
      dataQuality: COMPLETE_QUALITY,
    });

    expect(
      createAnalyticalRecommendation(scenario, {
        valid: false,
        confidenceCeiling: 0,
        requiresHumanReview: true,
        errors: ["verification failed"],
        warnings: [],
      }),
    ).toBeNull();

    const recommendation = createAnalyticalRecommendation(scenario, {
      valid: true,
      confidenceCeiling: 0.88,
      requiresHumanReview: true,
      errors: [],
      warnings: [],
    });
    expect(recommendation).toMatchObject({
      optionId: "scenario-recommend:direct",
      confidence: 0.88,
      requiresHumanReview: true,
      autonomyLevel: "A2",
      verifierPassed: true,
    });
    expect(recommendation?.expectedEffect[0]).toEqual({
      metric: "RESIDUAL_DEFICIT",
      from: 10,
      to: 0,
      unit: "EA",
    });
  });
});

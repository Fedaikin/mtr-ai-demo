import { describe, expect, it } from "vitest";

import { runForecast } from "@/application/agent-orchestrator/analytics/forecast-engine";
import type { DataQualityResult } from "@/domain/agent/analytics/quality";

const COMPLETE_QUALITY: DataQualityResult = {
  availability: "COMPLETE",
  completeness: 1,
  freshness: "FRESH",
  confidenceCeiling: 0.9,
  sourceAssessments: [],
  issues: [],
  requiresHumanReview: false,
};

describe("forecast engine", () => {
  it("selects a model by rolling-origin backtest and returns a bounded interval", () => {
    const start = Date.parse("2026-05-11T00:00:00.000Z");
    const forecast = runForecast({
      id: "forecast-linear",
      datasetVersion: "g1-vertical-v1",
      originAt: "2026-08-10T00:00:00.000Z",
      horizonWeeks: 3,
      observations: Array.from({ length: 13 }, (_, index) => ({
        weekStart: new Date(start + index * 7 * 24 * 60 * 60_000).toISOString(),
        quantity: 10 + index * 2,
        unit: "EA",
        evidenceNodeId: `movement-week-${index + 1}`,
      })),
      dataQuality: COMPLETE_QUALITY,
    });

    expect(forecast.status).toBe("COMPLETE");
    expect(forecast.selectedModel).toMatchObject({
      modelKey: "LINEAR_TREND",
      metrics: { originCount: 5, mae: 0, wape: 0, bias: 0 },
    });
    expect(forecast.points).toEqual([
      { weekStart: "2026-08-10T00:00:00.000Z", point: 36, lower: 36, upper: 36 },
      { weekStart: "2026-08-17T00:00:00.000Z", point: 38, lower: 38, upper: 38 },
      { weekStart: "2026-08-24T00:00:00.000Z", point: 40, lower: 40, upper: 40 },
    ]);
    expect(forecast.assessedModels).toHaveLength(3);
    expect(forecast.inputEvidenceNodeIds).toHaveLength(13);
  });

  it("abstains on partial data, mixed units, missing weeks or future observations", () => {
    const forecast = runForecast({
      id: "forecast-invalid",
      datasetVersion: "g1-vertical-v1",
      originAt: "2026-08-10T00:00:00.000Z",
      horizonWeeks: 4,
      observations: Array.from({ length: 10 }, (_, index) => ({
        weekStart: new Date(Date.parse("2026-06-01T00:00:00.000Z") + index * 8 * 24 * 60 * 60_000).toISOString(),
        quantity: index + 1,
        unit: index === 9 ? "KG" : "EA",
        evidenceNodeId: `bad-${index}`,
      })),
      dataQuality: { ...COMPLETE_QUALITY, availability: "PARTIAL", confidenceCeiling: 0.5 },
    });

    expect(forecast).toMatchObject({
      status: "UNAVAILABLE",
      selectedModel: null,
      assessedModels: [],
      points: [],
    });
    expect(forecast.limitations).toEqual(
      expect.arrayContaining([
        "История содержит несопоставимые единицы измерения.",
        "История должна содержать непрерывные недельные интервалы без пропусков.",
        "История содержит наблюдения после точки происхождения прогноза.",
        "Качество обязательных источников не позволяет числовой прогноз.",
      ]),
    );
  });
});

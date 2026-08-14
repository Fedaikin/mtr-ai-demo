import { describe, expect, it } from "vitest";

import { createModelAnalyticalDatasetPort } from "@/adapters/mock/agent-analytical-dataset-port";
import { generateAgentAnalyticalDataset } from "@/adapters/mock/fixtures/agent-analytical-dataset";
import {
  AnalyticalIntelligenceService,
  AnalyticalQueryError,
} from "@/application/agent-orchestrator/analytics/analytical-intelligence-service";

describe("analytical intelligence vertical", () => {
  it("runs dataset → quality → engines → evidence → verifier → public answer", async () => {
    const dataset = generateAgentAnalyticalDataset();
    const position = dataset.positions.find((item) =>
      dataset.shortages.some((shortage) => shortage.positionId === item.positionId),
    )!;
    const service = new AnalyticalIntelligenceService(createModelAnalyticalDatasetPort());
    const started = performance.now();
    const answer = await service.analyze({
      question: "Почему возникнет дефицит и что можно сделать?",
      projectId: "demo-project-001",
      positionId: position.positionId,
      horizonWeeks: 8,
      demandMultiplier: 1.1,
      deliveryDelayDays: 3,
    });

    expect(performance.now() - started).toBeLessThan(1_000);
    expect(answer).toMatchObject({
      schemaVersion: "mtr-analytical-answer-1.0.0",
      scope: {
        projectId: "demo-project-001",
        objectType: "POSITION",
        objectId: position.positionId,
        horizon: "8 нед.",
      },
      confidence: 0.9,
      requiresHumanReview: true,
      technicalTrace: {
        datasetVersion: "1.0.0-DEMO",
        semanticRegistryVersion: "semantic-registry-1.0.0",
        verifierPassed: true,
      },
    });
    expect(answer.confirmedFacts).toHaveLength(3);
    expect(answer.drivers.length).toBeGreaterThan(0);
    expect(answer.forecast).toMatchObject({
      status: "COMPLETE",
      horizonWeeks: 8,
      selectedModel: { modelVersion: expect.stringContaining("forecast-") },
    });
    expect(answer.forecast?.selectedModel?.metrics.originCount).toBeGreaterThanOrEqual(2);
    expect(answer.forecast?.points).toHaveLength(8);
    expect(answer.scenarios).not.toHaveLength(0);
    expect(answer.recommendation).toMatchObject({
      requiresHumanReview: true,
      autonomyLevel: "A2",
      verifierPassed: true,
    });
    expect(answer.citations.map((citation) => citation.sourceSystem)).toEqual([
      "APPIUS",
      "SAP",
      "CATALOG",
      "NORMATIVE",
    ]);
    expect(JSON.stringify(answer)).not.toMatch(/chain.of.thought|tool_calls|raw JSON/iu);
  });

  it("abstains on an intentionally unmapped position instead of inventing stock", async () => {
    const dataset = generateAgentAnalyticalDataset();
    const position = dataset.positions.find((item) => item.intentionalNegative)!;
    const service = new AnalyticalIntelligenceService(createModelAnalyticalDatasetPort());
    const answer = await service.analyze({
      question: "Спрогнозируй остаток",
      projectId: "demo-project-001",
      positionId: position.positionId,
      horizonWeeks: 4,
    });

    expect(answer).toMatchObject({
      executiveSummary: expect.stringContaining("Сквозной расчёт недоступен"),
      forecast: null,
      scenarios: [],
      recommendation: null,
      citations: [],
      confidence: 0,
      requiresHumanReview: true,
      technicalTrace: { verifierPassed: false },
    });
    expect(answer.missingData.map((item) => item.code)).toEqual(
      expect.arrayContaining(["SOURCE_INCOMPLETE", "SOURCE_STALE"]),
    );
  });

  it("denies another project before exposing the model dataset", async () => {
    const dataset = generateAgentAnalyticalDataset();
    const service = new AnalyticalIntelligenceService(createModelAnalyticalDatasetPort());

    await expect(
      service.analyze({
        question: "Анализ",
        projectId: "foreign-project",
        positionId: dataset.positions[0].positionId,
        horizonWeeks: 4,
      }),
    ).rejects.toThrow("ANALYTICAL_PROJECT_SCOPE_DENIED");
    await expect(
      service.analyze({
        question: "Анализ",
        projectId: "demo-project-001",
        positionId: "missing-position",
        horizonWeeks: 4,
      }),
    ).rejects.toBeInstanceOf(AnalyticalQueryError);
  });
});

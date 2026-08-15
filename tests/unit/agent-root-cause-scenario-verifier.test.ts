import { describe, expect, it } from "vitest";

import { verifyAnalyticalArtifacts } from "@/application/agent-orchestrator/analytics/analytical-verifier";
import { analyzeRootCauses } from "@/application/agent-orchestrator/analytics/root-cause-analyzer";
import { evaluateScenarios } from "@/application/agent-orchestrator/analytics/scenario-engine";
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

describe("root cause, scenario and verifier", () => {
  it("separates causal evidence from association and normalizes contributions", () => {
    const result = analyzeRootCauses({
      id: "rca-1",
      targetMetricKey: "SHORTAGE_QUANTITY",
      generatedAt: "2026-08-11T00:00:00.000Z",
      dataQuality: COMPLETE_QUALITY,
      signals: [
        {
          key: "demand",
          titleRu: "Рост расхода",
          baselineValue: 10,
          currentValue: 20,
          expectedDirection: "INCREASES_RISK",
          evidenceNodeIds: ["demand-before", "demand-after"],
          causalOracleId: "oracle-demand-spike",
        },
        {
          key: "lead-time",
          titleRu: "Рост срока поставки",
          baselineValue: 5,
          currentValue: 7.5,
          expectedDirection: "INCREASES_RISK",
          evidenceNodeIds: ["lead-time"],
        },
        {
          key: "inbound",
          titleRu: "Подтверждённые поступления",
          baselineValue: 4,
          currentValue: 8,
          expectedDirection: "DECREASES_RISK",
          evidenceNodeIds: ["inbound"],
        },
      ],
    });

    expect(result.conclusion).toBe("SUPPORTED_CAUSE");
    expect(result.hypotheses.map((item) => item.relationship)).toEqual([
      "CAUSAL",
      "ASSOCIATED",
      "NONE",
    ]);
    expect(
      result.hypotheses.reduce((sum, hypothesis) => sum + hypothesis.contribution, 0),
    ).toBe(1);
    expect(result.hypotheses[1].assumptions[0]).toContain("не доказывает причинность");
  });

  it("ranks only feasible immutable alternatives and keeps the human decision", () => {
    const scenario = evaluateScenarios({
      id: "scenario-1",
      datasetVersion: "g1-vertical-v1",
      createdAt: "2026-08-11T00:00:00.000Z",
      requiredQuantity: 10,
      unit: "EA",
      directAvailableQuantity: 2,
      procurementLeadTimeDays: 45,
      dataQuality: COMPLETE_QUALITY,
      candidates: [
        {
          materialCode: "ALT-1",
          quantity: 6,
          unit: "EA",
          leadTimeDays: 1,
          deviationScore: 0.05,
          normativeAllowed: true,
          fresh: true,
          evidenceNodeIds: ["candidate-1"],
        },
        {
          materialCode: "ALT-2",
          quantity: 6,
          unit: "EA",
          leadTimeDays: 2,
          deviationScore: 0.1,
          normativeAllowed: true,
          fresh: true,
          evidenceNodeIds: ["candidate-2"],
        },
        {
          materialCode: "DECOY",
          quantity: 100,
          unit: "EA",
          leadTimeDays: 0,
          deviationScore: 0,
          normativeAllowed: false,
          fresh: true,
          evidenceNodeIds: ["decoy"],
        },
      ],
    });

    const recommended = scenario.alternatives.find(
      (alternative) => alternative.id === scenario.recommendedAlternativeId,
    );
    expect(scenario.requiresHumanDecision).toBe(true);
    expect(recommended).toMatchObject({
      kind: "COMPOSITE_SUBSTITUTE",
      feasible: true,
      coveredQuantity: 10,
      remainingShortage: 0,
    });
    expect(recommended?.allocations.map((item) => item.materialCode)).toEqual(["ALT-1", "ALT-2"]);
    expect(scenario.alternatives.flatMap((item) => item.allocations).map((item) => item.materialCode))
      .not.toContain("DECOY");
  });

  it("fails verification for missing lineage and arithmetic mismatch", () => {
    const scenario = evaluateScenarios({
      id: "scenario-bad",
      datasetVersion: "g1-vertical-v1",
      createdAt: "2026-08-11T00:00:00.000Z",
      requiredQuantity: 5,
      unit: "EA",
      directAvailableQuantity: 0,
      procurementLeadTimeDays: 10,
      dataQuality: COMPLETE_QUALITY,
      candidates: [
        {
          materialCode: "ALT-X",
          quantity: 5,
          unit: "EA",
          leadTimeDays: 1,
          deviationScore: 0,
          normativeAllowed: true,
          fresh: true,
          evidenceNodeIds: ["missing-evidence"],
        },
      ],
    });
    const tampered = {
      ...scenario,
      alternatives: scenario.alternatives.map((item, index) =>
        index === 0 ? { ...item, coveredQuantity: item.coveredQuantity + 1 } : item,
      ),
    };

    const verification = verifyAnalyticalArtifacts({
      evidenceGraph: {
        id: "empty-graph",
        schemaVersion: "1.0.0",
        datasetVersion: "g1-vertical-v1",
        createdAt: "2026-08-11T00:00:00.000Z",
        nodes: [],
        edges: [],
      },
      scenario: tampered,
    });

    expect(verification.valid).toBe(false);
    expect(verification.confidenceCeiling).toBe(0);
    expect(verification.requiresHumanReview).toBe(true);
    expect(verification.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("арифметическое расхождение"),
        expect.stringContaining("отсутствующий evidence missing-evidence"),
      ]),
    );
  });
});

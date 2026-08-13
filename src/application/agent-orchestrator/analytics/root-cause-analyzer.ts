import type {
  HypothesisAssessment,
  RootCauseAssessment,
  RootCauseSignal,
} from "@/domain/agent/analytics/artifacts";
import type { DataQualityResult } from "@/domain/agent/analytics/quality";

export interface RootCauseRequest {
  readonly id: string;
  readonly targetMetricKey: string;
  readonly generatedAt: string;
  readonly signals: readonly RootCauseSignal[];
  readonly dataQuality: DataQualityResult;
}

export function analyzeRootCauses(request: RootCauseRequest): RootCauseAssessment {
  if (request.dataQuality.availability === "UNAVAILABLE" || request.signals.length === 0) {
    return {
      id: request.id,
      schemaVersion: "1.0.0",
      targetMetricKey: request.targetMetricKey,
      generatedAt: request.generatedAt,
      hypotheses: request.signals.map((signal) => unknownHypothesis(signal)),
      conclusion: "INSUFFICIENT_EVIDENCE",
      dataQuality: request.dataQuality,
    };
  }

  const rawContributions = request.signals.map((signal) => riskContribution(signal));
  const total = rawContributions.reduce((sum, value) => sum + value, 0);
  const hypotheses: HypothesisAssessment[] = request.signals.map((signal, index) => {
    const rawContribution = rawContributions[index];
    const changed = rawContribution > 0;
    const causal = Boolean(signal.causalOracleId && changed);
    return {
      id: `hypothesis:${signal.key}`,
      titleRu: signal.titleRu,
      status: changed ? "SUPPORTED" : "REFUTED",
      relationship: changed ? (causal ? "CAUSAL" : "ASSOCIATED") : "NONE",
      contribution: total > 0 ? round(rawContribution / total) : 0,
      confidence: round(
        Math.min(request.dataQuality.confidenceCeiling, causal ? 0.95 : changed ? 0.65 : 0.75),
      ),
      evidenceNodeIds: signal.evidenceNodeIds,
      counterEvidenceNodeIds: [],
      assumptions: causal
        ? []
        : changed
          ? ["Наблюдаемая связь не доказывает причинность без causal oracle или интервенции."]
          : [],
    };
  });
  const hasCausal = hypotheses.some(
    (hypothesis) => hypothesis.status === "SUPPORTED" && hypothesis.relationship === "CAUSAL",
  );
  const hasAssociation = hypotheses.some(
    (hypothesis) => hypothesis.status === "SUPPORTED" && hypothesis.relationship === "ASSOCIATED",
  );

  return {
    id: request.id,
    schemaVersion: "1.0.0",
    targetMetricKey: request.targetMetricKey,
    generatedAt: request.generatedAt,
    hypotheses: hypotheses.sort((left, right) => right.contribution - left.contribution),
    conclusion: hasCausal
      ? "SUPPORTED_CAUSE"
      : hasAssociation
        ? "ASSOCIATIONS_ONLY"
        : "INSUFFICIENT_EVIDENCE",
    dataQuality: request.dataQuality,
  };
}

function unknownHypothesis(signal: RootCauseSignal): HypothesisAssessment {
  return {
    id: `hypothesis:${signal.key}`,
    titleRu: signal.titleRu,
    status: "UNKNOWN",
    relationship: "UNKNOWN",
    contribution: 0,
    confidence: 0,
    evidenceNodeIds: signal.evidenceNodeIds,
    counterEvidenceNodeIds: [],
    assumptions: ["Недостаточно качественных данных для проверки гипотезы."],
  };
}

function riskContribution(signal: RootCauseSignal): number {
  const delta = signal.currentValue - signal.baselineValue;
  const directional = signal.expectedDirection === "INCREASES_RISK" ? delta : -delta;
  return Math.max(0, directional / Math.max(1, Math.abs(signal.baselineValue)));
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

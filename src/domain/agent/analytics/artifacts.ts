import type { DataQualityResult } from "@/domain/agent/analytics/quality";

export const FORECAST_MODEL_KEYS = ["NAIVE_LAST", "MOVING_AVERAGE_4", "LINEAR_TREND"] as const;
export type ForecastModelKey = (typeof FORECAST_MODEL_KEYS)[number];

export interface WeeklyDemandObservation {
  readonly weekStart: string;
  readonly quantity: number;
  readonly unit: string;
  readonly evidenceNodeId: string;
}

export interface ForecastBacktestMetrics {
  readonly originCount: number;
  readonly mae: number;
  readonly wape: number;
  readonly bias: number;
}

export interface ForecastModelAssessment {
  readonly modelKey: ForecastModelKey;
  readonly modelVersion: string;
  readonly metrics: ForecastBacktestMetrics;
}

export interface ForecastPoint {
  readonly weekStart: string;
  readonly point: number;
  readonly lower: number;
  readonly upper: number;
}

export interface ForecastRun {
  readonly id: string;
  readonly schemaVersion: "1.0.0";
  readonly status: "COMPLETE" | "UNAVAILABLE";
  readonly datasetVersion: string;
  readonly originAt: string;
  readonly horizonWeeks: number;
  readonly unit: string | null;
  readonly selectedModel: ForecastModelAssessment | null;
  readonly assessedModels: readonly ForecastModelAssessment[];
  readonly points: readonly ForecastPoint[];
  readonly assumptions: readonly string[];
  readonly limitations: readonly string[];
  readonly inputEvidenceNodeIds: readonly string[];
  readonly dataQuality: DataQualityResult;
}

export const HYPOTHESIS_STATUSES = ["UNTESTED", "SUPPORTED", "REFUTED", "UNKNOWN"] as const;
export type HypothesisStatus = (typeof HYPOTHESIS_STATUSES)[number];

export interface RootCauseSignal {
  readonly key: string;
  readonly titleRu: string;
  readonly baselineValue: number;
  readonly currentValue: number;
  readonly expectedDirection: "INCREASES_RISK" | "DECREASES_RISK";
  readonly evidenceNodeIds: readonly string[];
  readonly causalOracleId?: string | null;
}

export interface HypothesisAssessment {
  readonly id: string;
  readonly titleRu: string;
  readonly status: HypothesisStatus;
  readonly relationship: "CAUSAL" | "ASSOCIATED" | "NONE" | "UNKNOWN";
  readonly contribution: number;
  readonly confidence: number;
  readonly evidenceNodeIds: readonly string[];
  readonly counterEvidenceNodeIds: readonly string[];
  readonly assumptions: readonly string[];
}

export interface RootCauseAssessment {
  readonly id: string;
  readonly schemaVersion: "1.0.0";
  readonly targetMetricKey: string;
  readonly generatedAt: string;
  readonly hypotheses: readonly HypothesisAssessment[];
  readonly conclusion: "SUPPORTED_CAUSE" | "ASSOCIATIONS_ONLY" | "INSUFFICIENT_EVIDENCE";
  readonly dataQuality: DataQualityResult;
}

export interface ScenarioCandidate {
  readonly materialCode: string;
  readonly quantity: number;
  readonly unit: string;
  readonly leadTimeDays: number;
  readonly deviationScore: number;
  readonly normativeAllowed: boolean;
  readonly fresh: boolean;
  readonly evidenceNodeIds: readonly string[];
}

export interface AnalyticalScenarioAlternative {
  readonly id: string;
  readonly kind: "DIRECT" | "SINGLE_SUBSTITUTE" | "COMPOSITE_SUBSTITUTE" | "PROCUREMENT";
  readonly allocations: readonly {
    readonly materialCode: string;
    readonly quantity: number;
    readonly unit: string;
  }[];
  readonly coveredQuantity: number;
  readonly remainingShortage: number;
  readonly maxLeadTimeDays: number;
  readonly deviationScore: number;
  readonly score: number;
  readonly feasible: boolean;
  readonly rejectedReasons: readonly string[];
  readonly evidenceNodeIds: readonly string[];
}

export interface AnalyticalScenarioRun {
  readonly id: string;
  readonly schemaVersion: "1.0.0";
  readonly datasetVersion: string;
  readonly createdAt: string;
  readonly requiredQuantity: number;
  readonly unit: string;
  readonly alternatives: readonly AnalyticalScenarioAlternative[];
  readonly recommendedAlternativeId: string | null;
  readonly requiresHumanDecision: true;
  readonly dataQuality: DataQualityResult;
}

export interface VerificationResult {
  readonly valid: boolean;
  readonly confidenceCeiling: number;
  readonly requiresHumanReview: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

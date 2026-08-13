import type {
  AnalyticalRecommendation,
  AnalyticalScenarioAlternative,
  ForecastRun,
  HypothesisAssessment,
  TrendAnomalyResult,
} from "@/domain/agent/analytics/artifacts";
import type { DataQualityResult } from "@/domain/agent/analytics/quality";

export interface AnalyticalQuery {
  readonly question: string;
  readonly projectId: string;
  readonly positionId: string;
  readonly horizonWeeks: number;
  readonly demandMultiplier?: number;
  readonly deliveryDelayDays?: number;
}

export interface PublicAnalyticalCitation {
  readonly sourceSystem: "APPIUS" | "SAP" | "CATALOG" | "NORMATIVE" | "PROCESS_ENGINE";
  readonly entityType: string;
  readonly entityId: string;
  readonly versionOrSnapshot: string;
  readonly observedAt: string;
  readonly clauseId: string | null;
}

export interface PublicAnalyticalAnswer {
  readonly schemaVersion: "mtr-analytical-answer-1.0.0";
  readonly question: string;
  readonly scope: {
    readonly projectId: string;
    readonly objectType: "POSITION";
    readonly objectId: string;
    readonly horizon: string;
  };
  readonly executiveSummary: string;
  readonly confirmedFacts: readonly {
    readonly id: string;
    readonly text: string;
    readonly evidenceNodeIds: readonly string[];
  }[];
  readonly findings: readonly {
    readonly id: string;
    readonly text: string;
    readonly severity: "INFO" | "WARNING" | "CRITICAL";
  }[];
  readonly drivers: readonly HypothesisAssessment[];
  readonly trend: TrendAnomalyResult | null;
  readonly forecast: ForecastRun | null;
  readonly scenarios: readonly AnalyticalScenarioAlternative[];
  readonly recommendation: AnalyticalRecommendation | null;
  readonly uncertainty: {
    readonly dataQuality: DataQualityResult;
    readonly assumptions: readonly string[];
    readonly limitations: readonly string[];
  };
  readonly missingData: readonly { readonly code: string; readonly messageRu: string }[];
  readonly conflicts: readonly { readonly code: string; readonly messageRu: string }[];
  readonly citations: readonly PublicAnalyticalCitation[];
  readonly nextActions: readonly string[];
  readonly confidence: number;
  readonly requiresHumanReview: boolean;
  readonly generatedAt: string;
  readonly technicalTrace: {
    readonly datasetVersion: string;
    readonly semanticRegistryVersion: string;
    readonly evidenceGraphId: string;
    readonly verifierPassed: boolean;
  };
}

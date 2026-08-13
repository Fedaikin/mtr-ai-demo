export type UniversalAnswerMode = "PRIMARY_LLM" | "DETERMINISTIC_FALLBACK";

export interface UniversalEntityRef {
  readonly kind: "BUSINESS_PROJECT" | "SPECIFICATION" | "MATERIAL" | "POSITION";
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly confidence: number;
}

export interface UniversalResolvedContext {
  readonly businessProject?: UniversalEntityRef;
  readonly specification?: UniversalEntityRef;
  readonly material?: UniversalEntityRef;
  readonly period?: Readonly<{ from: string; to: string; timezone: "Europe/Moscow" }>;
  readonly purpose?: "CONSTRUCTION" | "MAINTENANCE" | "REPAIR" | "SPARES";
}

export interface UniversalFactCard {
  readonly key: string;
  readonly label: string;
  readonly value: string | number;
  readonly unit?: string;
  readonly status?: "NORMAL" | "ATTENTION" | "CRITICAL" | "UNKNOWN";
}

export interface UniversalDataTable {
  readonly id: string;
  readonly title: string;
  readonly columns: readonly string[];
  readonly rows: readonly Readonly<Record<string, string | number | null>>[];
  readonly totalRows: number;
}

export interface UniversalRiskCard {
  readonly id: string;
  readonly level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  readonly title: string;
  readonly explanation: string;
  readonly materialCode?: string;
}

export interface UniversalCompatibilityResult {
  readonly sourceMaterialCode: string;
  readonly candidateMaterialCode: string;
  readonly technicalCompatibilityPercent: number | null;
  readonly quantityCoveragePercent: number;
  readonly verdict:
    | "EXACT"
    | "COMPATIBLE"
    | "CONDITIONAL"
    | "ENGINEERING_REVIEW"
    | "NOT_RECOMMENDED"
    | "PROHIBITED"
    | "INSUFFICIENT_DATA";
  readonly scoreBreakdown: readonly Readonly<{
    key: string;
    label: string;
    weight: number;
    awarded: number;
  }>[];
  readonly deviations: readonly string[];
  readonly normativeBasis: string | null;
  readonly requiresHumanReview: boolean;
  readonly engineVersion: string;
}

export interface UniversalRecommendationCard {
  readonly id: string;
  readonly kind: "REORDER" | "REPLACEMENT" | "EXPERT_REVIEW" | "MONITOR";
  readonly title: string;
  readonly explanation: string;
  readonly materialCode?: string;
  readonly quantity?: number;
  readonly unit?: string;
  readonly residualRisk: string;
}

export interface UniversalActionCard {
  readonly id: string;
  readonly kind: "CREATE_EXPERT_TASK" | "PURCHASE_REQUEST_DRAFT" | "OPEN_DETAILS";
  readonly title: string;
  readonly enabled: boolean;
  readonly requiresConfirmation: boolean;
}

export interface UniversalCitation {
  readonly sourceSystem: "APPIUS" | "SAP" | "CATALOG" | "NORMATIVE" | "FORECAST" | "PROCESS";
  readonly entityId: string;
  readonly versionOrSnapshot: string;
  readonly label: string;
  readonly observedAt: string;
  readonly clauseId?: string | null;
}

export interface UniversalMissingDataItem {
  readonly code: string;
  readonly message: string;
  readonly impact: string;
}

export interface UniversalAgentAnswer {
  readonly summary: string;
  readonly resolvedContext: UniversalResolvedContext;
  readonly facts: readonly UniversalFactCard[];
  readonly tables: readonly UniversalDataTable[];
  readonly risks: readonly UniversalRiskCard[];
  readonly compatibility: readonly UniversalCompatibilityResult[];
  readonly recommendations: readonly UniversalRecommendationCard[];
  readonly actions: readonly UniversalActionCard[];
  readonly citations: readonly UniversalCitation[];
  readonly missingData: readonly UniversalMissingDataItem[];
  readonly confidence: number;
  readonly requiresHumanReview: boolean;
  readonly generatedAt: string;
  readonly mode: UniversalAnswerMode;
  readonly runtime?: Readonly<{
    provider: "OPENAI";
    model: string;
    providerVersion: string;
    promptVersion: string;
  }>;
}

export interface UniversalClarification {
  readonly kind: "ASK_CLARIFICATION";
  readonly question: string;
  readonly candidates: readonly UniversalEntityRef[];
}

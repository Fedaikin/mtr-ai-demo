export const ANALYTICAL_METRIC_KEYS = [
  "AVAILABLE_QUANTITY",
  "PROJECTED_AVAILABLE_QUANTITY",
  "AVERAGE_WEEKLY_CONSUMPTION",
  "STOCK_COVERAGE_DAYS",
  "SHORTAGE_QUANTITY",
  "SHORTAGE_RISK_SCORE",
] as const;

export type AnalyticalMetricKey = (typeof ANALYTICAL_METRIC_KEYS)[number];

export type AnalyticalUnknownPolicy = "ABSTAIN" | "RETURN_UNKNOWN";

export interface SemanticSourcePriority {
  readonly sourceSystem: "SAP" | "APPIUS" | "CATALOG" | "NORMATIVE" | "PROCESS_ENGINE";
  readonly priority: number;
  readonly required: boolean;
}

export interface SemanticFreshnessPolicy {
  readonly maxAgeMinutes: number;
  readonly maxCrossSourceSkewMinutes: number;
  readonly staleBehavior: "ABSTAIN" | "LOWER_CONFIDENCE";
}

export interface SemanticDefinition {
  readonly key: AnalyticalMetricKey;
  readonly version: string;
  readonly titleRu: string;
  readonly definitionRu: string;
  readonly formula: string;
  readonly unit: "EA" | "DAYS" | "RATIO";
  readonly timezone: "UTC";
  readonly sourcePriority: readonly SemanticSourcePriority[];
  readonly freshness: SemanticFreshnessPolicy;
  readonly unknownPolicy: AnalyticalUnknownPolicy;
}

const COMMON_STOCK_SOURCES: readonly SemanticSourcePriority[] = Object.freeze([
  { sourceSystem: "SAP", priority: 1, required: true },
  { sourceSystem: "CATALOG", priority: 2, required: true },
]);

export const ANALYTICAL_SEMANTIC_REGISTRY: Readonly<
  Record<AnalyticalMetricKey, SemanticDefinition>
> = Object.freeze({
  AVAILABLE_QUANTITY: definition({
    key: "AVAILABLE_QUANTITY",
    titleRu: "Доступный остаток",
    definitionRu: "Физический остаток за вычетом резервов и карантина на момент среза.",
    formula: "on_hand - reserved - quarantined",
    unit: "EA",
    sourcePriority: COMMON_STOCK_SOURCES,
  }),
  PROJECTED_AVAILABLE_QUANTITY: definition({
    key: "PROJECTED_AVAILABLE_QUANTITY",
    titleRu: "Прогнозный доступный остаток",
    definitionRu:
      "Доступный остаток с учётом подтверждённых поступлений и ожидаемого расхода на горизонте.",
    formula: "available + confirmed_inbound - forecast_demand",
    unit: "EA",
    sourcePriority: COMMON_STOCK_SOURCES,
  }),
  AVERAGE_WEEKLY_CONSUMPTION: definition({
    key: "AVERAGE_WEEKLY_CONSUMPTION",
    titleRu: "Средний недельный расход",
    definitionRu: "Среднее фактическое потребление за полные календарные недели наблюдения.",
    formula: "sum(consumption_quantity) / complete_week_count",
    unit: "EA",
    sourcePriority: [{ sourceSystem: "SAP", priority: 1, required: true }],
  }),
  STOCK_COVERAGE_DAYS: definition({
    key: "STOCK_COVERAGE_DAYS",
    titleRu: "Покрытие запасом",
    definitionRu: "Число дней, на которое хватит доступного остатка при наблюдаемом темпе расхода.",
    formula: "available_quantity / average_daily_consumption",
    unit: "DAYS",
    sourcePriority: COMMON_STOCK_SOURCES,
  }),
  SHORTAGE_QUANTITY: definition({
    key: "SHORTAGE_QUANTITY",
    titleRu: "Прогнозный дефицит",
    definitionRu: "Неотрицательная разница между потребностью и прогнозным доступным остатком.",
    formula: "max(0, required_quantity - projected_available_quantity)",
    unit: "EA",
    sourcePriority: [
      { sourceSystem: "APPIUS", priority: 1, required: true },
      ...COMMON_STOCK_SOURCES,
    ],
  }),
  SHORTAGE_RISK_SCORE: definition({
    key: "SHORTAGE_RISK_SCORE",
    titleRu: "Оценка риска дефицита",
    definitionRu:
      "Нормированная оценка ожидаемого дефицита с учётом покрытия, lead time и качества данных.",
    formula: "clamp(shortage_ratio * lead_time_factor * quality_factor, 0, 1)",
    unit: "RATIO",
    sourcePriority: [
      { sourceSystem: "APPIUS", priority: 1, required: true },
      ...COMMON_STOCK_SOURCES,
    ],
  }),
});

export function semanticDefinition(key: AnalyticalMetricKey): SemanticDefinition {
  return ANALYTICAL_SEMANTIC_REGISTRY[key];
}

function definition(
  input: Omit<
    SemanticDefinition,
    "version" | "timezone" | "freshness" | "unknownPolicy"
  >,
): SemanticDefinition {
  return Object.freeze({
    ...input,
    version: "semantic-registry-1.0.0",
    timezone: "UTC",
    freshness: {
      maxAgeMinutes: 15,
      maxCrossSourceSkewMinutes: 15,
      staleBehavior: "ABSTAIN" as const,
    },
    unknownPolicy: "RETURN_UNKNOWN",
  });
}

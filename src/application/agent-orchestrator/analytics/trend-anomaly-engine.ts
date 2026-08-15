import type {
  TrendAnomalyResult,
  WeeklyDemandObservation,
} from "@/domain/agent/analytics/artifacts";

const WEEK_MS = 7 * 24 * 60 * 60_000;

export function analyzeTrend(
  observations: readonly WeeklyDemandObservation[],
): TrendAnomalyResult {
  if (observations.length < 8 || new Set(observations.map((item) => item.unit)).size !== 1) {
    return unavailable(observations, "Недостаточно сопоставимой недельной истории для анализа тренда.");
  }
  const sorted = [...observations].sort(
    (left, right) => Date.parse(left.weekStart) - Date.parse(right.weekStart),
  );
  if (sorted.some((item) => !Number.isFinite(item.quantity) || item.quantity < 0)) {
    return unavailable(observations, "История содержит некорректное значение расхода.");
  }
  let missingWeekCount = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const distance = Date.parse(sorted[index].weekStart) - Date.parse(sorted[index - 1].weekStart);
    if (distance > WEEK_MS) missingWeekCount += Math.max(0, Math.round(distance / WEEK_MS) - 1);
  }
  const baselineValues = sorted.slice(0, -1).map((item) => item.quantity);
  const baselineMedian = median(baselineValues);
  const deviations = baselineValues.map((value) => Math.abs(value - baselineMedian));
  const mad = median(deviations);
  const currentValue = sorted.at(-1)!.quantity;
  const robustZScore = mad === 0
    ? currentValue === baselineMedian
      ? 0
      : currentValue > baselineMedian
        ? Number.POSITIVE_INFINITY
        : Number.NEGATIVE_INFINITY
    : (0.6745 * (currentValue - baselineMedian)) / mad;
  const relativeChange = baselineMedian === 0
    ? currentValue === 0
      ? 0
      : null
    : (currentValue - baselineMedian) / baselineMedian;
  const anomaly = robustZScore > 3.5 ? "SPIKE" : robustZScore < -3.5 ? "DROP" : "NONE";
  const direction = relativeChange === null
    ? "UNKNOWN"
    : relativeChange > 0.1
      ? "UP"
      : relativeChange < -0.1
        ? "DOWN"
        : "STABLE";

  return {
    status: "COMPLETE",
    direction,
    baselineMedian: round(baselineMedian),
    currentValue: round(currentValue),
    relativeChange: relativeChange === null ? null : round(relativeChange),
    anomaly,
    robustZScore: Number.isFinite(robustZScore) ? round(robustZScore) : robustZScore,
    missingWeekCount,
    explanationRu:
      anomaly === "NONE"
        ? "Последнее наблюдение находится в устойчивом диапазоне robust baseline."
        : anomaly === "SPIKE"
          ? "Последний расход существенно выше robust baseline."
          : "Последний расход существенно ниже robust baseline.",
    evidenceNodeIds: sorted.map((item) => item.evidenceNodeId),
    serviceVersion: "trend-anomaly-engine-1.0.0",
  };
}

function unavailable(
  observations: readonly WeeklyDemandObservation[],
  explanationRu: string,
): TrendAnomalyResult {
  return {
    status: "UNAVAILABLE",
    direction: "UNKNOWN",
    baselineMedian: null,
    currentValue: null,
    relativeChange: null,
    anomaly: "UNKNOWN",
    robustZScore: null,
    missingWeekCount: 0,
    explanationRu,
    evidenceNodeIds: observations.map((item) => item.evidenceNodeId),
    serviceVersion: "trend-anomaly-engine-1.0.0",
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

import type {
  ForecastBacktestMetrics,
  ForecastModelAssessment,
  ForecastModelKey,
  ForecastRun,
  WeeklyDemandObservation,
} from "@/domain/agent/analytics/artifacts";
import type { DataQualityResult } from "@/domain/agent/analytics/quality";

const WEEK_MS = 7 * 24 * 60 * 60_000;
const MIN_TRAINING_WEEKS = 8;

export interface ForecastRequest {
  readonly id: string;
  readonly datasetVersion: string;
  readonly originAt: string;
  readonly horizonWeeks: number;
  readonly observations: readonly WeeklyDemandObservation[];
  readonly dataQuality: DataQualityResult;
}

export function runForecast(request: ForecastRequest): ForecastRun {
  const unavailable = validate(request);
  const inputEvidenceNodeIds = request.observations.map((item) => item.evidenceNodeId);
  if (unavailable.length > 0 || request.dataQuality.availability !== "COMPLETE") {
    return {
      id: request.id,
      schemaVersion: "1.0.0",
      status: "UNAVAILABLE",
      datasetVersion: request.datasetVersion,
      originAt: request.originAt,
      horizonWeeks: request.horizonWeeks,
      unit: request.observations[0]?.unit ?? null,
      selectedModel: null,
      assessedModels: [],
      points: [],
      assumptions: [],
      limitations: [
        ...unavailable,
        ...(request.dataQuality.availability === "COMPLETE"
          ? []
          : ["Качество обязательных источников не позволяет числовой прогноз."]),
      ],
      inputEvidenceNodeIds,
      dataQuality: request.dataQuality,
    };
  }

  const quantities = request.observations.map((item) => item.quantity);
  const assessedModels = (["NAIVE_LAST", "MOVING_AVERAGE_4", "LINEAR_TREND"] as const)
    .map((modelKey) => assessModel(modelKey, quantities))
    .sort(compareAssessments);
  const selectedModel = assessedModels[0];
  const residualMargin = intervalMargin(selectedModel.metrics);
  const points = Array.from({ length: request.horizonWeeks }, (_, index) => {
    const point = Math.max(0, predict(selectedModel.modelKey, quantities, index + 1));
    const weekStart = new Date(Date.parse(request.observations.at(-1)!.weekStart) + WEEK_MS * (index + 1));
    return {
      weekStart: weekStart.toISOString(),
      point: round(point),
      lower: round(Math.max(0, point - residualMargin)),
      upper: round(point + residualMargin),
    };
  });

  return {
    id: request.id,
    schemaVersion: "1.0.0",
    status: "COMPLETE",
    datasetVersion: request.datasetVersion,
    originAt: request.originAt,
    horizonWeeks: request.horizonWeeks,
    unit: request.observations[0].unit,
    selectedModel,
    assessedModels,
    points,
    assumptions: [
      "Наблюдения агрегированы по полным календарным неделям.",
      "Структурный разрыв после originAt не моделируется.",
    ],
    limitations: ["Интервал построен по rolling-origin абсолютной ошибке, а не как вероятностная гарантия."],
    inputEvidenceNodeIds,
    dataQuality: request.dataQuality,
  };
}

function validate(request: ForecastRequest): string[] {
  const limitations: string[] = [];
  if (!Number.isInteger(request.horizonWeeks) || request.horizonWeeks < 1 || request.horizonWeeks > 26) {
    limitations.push("Горизонт должен быть целым числом от 1 до 26 недель.");
  }
  if (request.observations.length < MIN_TRAINING_WEEKS + 2) {
    limitations.push("Для backtest требуется не менее десяти недель истории.");
  }
  const units = new Set(request.observations.map((item) => item.unit));
  if (units.size !== 1) limitations.push("История содержит несопоставимые единицы измерения.");
  if (request.observations.some((item) => !Number.isFinite(item.quantity) || item.quantity < 0)) {
    limitations.push("История содержит отрицательное или нечисловое потребление.");
  }
  const timestamps = request.observations.map((item) => Date.parse(item.weekStart));
  if (timestamps.some((time) => !Number.isFinite(time))) limitations.push("История содержит некорректную дату.");
  for (let index = 1; index < timestamps.length; index += 1) {
    if (timestamps[index] - timestamps[index - 1] !== WEEK_MS) {
      limitations.push("История должна содержать непрерывные недельные интервалы без пропусков.");
      break;
    }
  }
  if (timestamps.some((time) => time > Date.parse(request.originAt))) {
    limitations.push("История содержит наблюдения после точки происхождения прогноза.");
  }
  return limitations;
}

function assessModel(modelKey: ForecastModelKey, values: readonly number[]): ForecastModelAssessment {
  const errors: number[] = [];
  const actuals: number[] = [];
  const signedErrors: number[] = [];
  for (let origin = MIN_TRAINING_WEEKS; origin < values.length; origin += 1) {
    const training = values.slice(0, origin);
    const predicted = Math.max(0, predict(modelKey, training, 1));
    const actual = values[origin];
    errors.push(Math.abs(predicted - actual));
    signedErrors.push(predicted - actual);
    actuals.push(actual);
  }
  const metrics: ForecastBacktestMetrics = {
    originCount: errors.length,
    mae: round(mean(errors)),
    wape: round(actuals.reduce((sum, value) => sum + value, 0) === 0
      ? mean(errors)
      : errors.reduce((sum, value) => sum + value, 0) /
        actuals.reduce((sum, value) => sum + value, 0)),
    bias: round(mean(signedErrors)),
  };
  return {
    modelKey,
    modelVersion: `forecast-${modelKey.toLocaleLowerCase("en-US").replaceAll("_", "-")}-1.0.0`,
    metrics,
  };
}

function predict(modelKey: ForecastModelKey, values: readonly number[], horizonStep: number): number {
  if (modelKey === "NAIVE_LAST") return values.at(-1) ?? 0;
  if (modelKey === "MOVING_AVERAGE_4") return mean(values.slice(-4));
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = mean(values);
  const numerator = values.reduce((sum, value, index) => sum + (index - meanX) * (value - meanY), 0);
  const denominator = values.reduce((sum, _value, index) => sum + (index - meanX) ** 2, 0);
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - slope * meanX;
  return intercept + slope * (n - 1 + horizonStep);
}

function compareAssessments(left: ForecastModelAssessment, right: ForecastModelAssessment): number {
  return left.metrics.wape - right.metrics.wape ||
    left.metrics.mae - right.metrics.mae ||
    left.modelKey.localeCompare(right.modelKey);
}

function intervalMargin(metrics: ForecastBacktestMetrics): number {
  return Math.max(0, metrics.mae * 1.96);
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

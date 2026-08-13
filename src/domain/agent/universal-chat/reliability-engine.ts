import type { ReliabilityProfile } from "@/domain/agent/universal-chat/dataset";

export const RELIABILITY_ENGINE_VERSION = "reliability-comparison-v1" as const;

export interface ReliabilityComparison {
  readonly baselineFailureProbability: number;
  readonly candidateFailureProbability: number;
  readonly relativeRiskReductionPercent: number;
  readonly verdict: "IMPROVES" | "NO_IMPROVEMENT" | "INSUFFICIENT_DATA";
  readonly assumptions: readonly string[];
  readonly residualRisk: string;
  readonly engineVersion: typeof RELIABILITY_ENGINE_VERSION;
}

export function compareReliability(
  baseline: ReliabilityProfile | null,
  candidate: ReliabilityProfile | null,
  operatingHours: number,
): ReliabilityComparison {
  if (!baseline || !candidate || operatingHours <= 0 || baseline.mtbfHours <= 0 || candidate.mtbfHours <= 0) {
    return {
      baselineFailureProbability: 0,
      candidateFailureProbability: 0,
      relativeRiskReductionPercent: 0,
      verdict: "INSUFFICIENT_DATA",
      assumptions: ["Нет сопоставимого профиля надёжности или горизонта наработки"],
      residualRisk: "Совместимость может быть подтверждена отдельно, но рост надёжности не доказан.",
      engineVersion: RELIABILITY_ENGINE_VERSION,
    };
  }
  const baselineFailureProbability = failureProbability(operatingHours, baseline.mtbfHours);
  const candidateFailureProbability = failureProbability(operatingHours, candidate.mtbfHours);
  const reduction = baselineFailureProbability === 0
    ? 0
    : (baselineFailureProbability - candidateFailureProbability) / baselineFailureProbability;
  const supplyWorsened = candidate.supplyRiskPercent > baseline.supplyRiskPercent + 10;
  const improves = reduction >= 0.05 && !supplyWorsened;
  return {
    baselineFailureProbability: round(baselineFailureProbability),
    candidateFailureProbability: round(candidateFailureProbability),
    relativeRiskReductionPercent: round(reduction * 100),
    verdict: improves ? "IMPROVES" : "NO_IMPROVEMENT",
    assumptions: [
      `Сопоставимая наработка: ${operatingHours} ч`,
      "Интенсивность отказов считается постоянной на выбранном горизонте",
    ],
    residualRisk: supplyWorsened
      ? "Риск снабжения кандидата выше допустимого порога."
      : improves
        ? "Сохраняются риски поставки, качества и фактического режима эксплуатации."
        : "Практически значимое снижение риска отказа не подтверждено.",
    engineVersion: RELIABILITY_ENGINE_VERSION,
  };
}

export function failureProbability(operatingHours: number, mtbfHours: number): number {
  if (operatingHours < 0 || mtbfHours <= 0) throw new Error("RELIABILITY_INPUT_INVALID");
  return 1 - Math.exp(-operatingHours / mtbfHours);
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

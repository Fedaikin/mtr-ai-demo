import type { CatalogueCharacteristicValue } from "@/domain/catalogue";
import type { UniversalCompatibilityResult } from "@/domain/agent/universal-chat/answer";

export const COMPATIBILITY_ENGINE_VERSION = "technical-compatibility-v1" as const;

export interface CompatibilityItem {
  readonly materialCode: string;
  readonly equipmentType: string;
  readonly itemKind: "COMPONENT" | "ASSEMBLY";
  readonly familyId: string | null;
  readonly unit: string;
  readonly standard: string | null;
  readonly materialGrade: string | null;
  readonly manufacturer: string | null;
  readonly characteristics: Readonly<Record<string, CatalogueCharacteristicValue>>;
  readonly compatibilityStatus: "VALID_MEMBER" | "INCOMPATIBLE_DECOY" | "NOT_APPLICABLE";
}

export interface CompatibilityEvaluationInput {
  readonly source: CompatibilityItem;
  readonly candidate: CompatibilityItem;
  readonly candidateAvailableQuantity: number;
  readonly requiredQuantity: number;
  readonly normativeBasis: string | null;
}

const SCORE_COMPONENTS = [
  ["normative", "Нормативная применимость", 20],
  ["function", "Функция и тип", 15],
  ["dimensions", "Критические размеры и интерфейсы", 25],
  ["standard", "Стандарт", 15],
  ["material", "Материал и марка", 10],
  ["performance", "Рабочие параметры", 10],
  ["family", "Квалифицированное семейство", 5],
] as const;

export function evaluateTechnicalCompatibility(
  input: CompatibilityEvaluationInput,
): UniversalCompatibilityResult {
  const quantityCoveragePercent = roundPercent(
    input.requiredQuantity <= 0
      ? 0
      : Math.min(1, Math.max(0, input.candidateAvailableQuantity) / input.requiredQuantity) * 100,
  );
  const prohibitedReason = hardGateFailure(input);
  if (prohibitedReason) {
    return result(input, 0, quantityCoveragePercent, "PROHIBITED", [prohibitedReason], true, []);
  }
  if (!input.normativeBasis || !hasRequiredTechnicalFacts(input.source) || !hasRequiredTechnicalFacts(input.candidate)) {
    return result(
      input,
      null,
      quantityCoveragePercent,
      "INSUFFICIENT_DATA",
      ["Недостаточно нормативных или технических данных для расчёта"],
      true,
      [],
    );
  }

  const sameFamily = input.source.familyId !== null && input.source.familyId === input.candidate.familyId;
  const scoreValues: Record<(typeof SCORE_COMPONENTS)[number][0], number> = {
    normative: 20,
    function: 15,
    dimensions: sameFamily || sameCriticalCharacteristics(input.source, input.candidate) ? 25 : 18,
    standard: input.source.standard === input.candidate.standard ? 15 : 11,
    material: input.source.materialGrade === input.candidate.materialGrade ? 10 : 7,
    performance: samePerformanceCharacteristics(input.source, input.candidate) ? 10 : 7,
    family: sameFamily ? 5 : 2,
  };
  const scoreBreakdown = SCORE_COMPONENTS.map(([key, label, weight]) => ({
    key,
    label,
    weight,
    awarded: scoreValues[key],
  }));
  const score = scoreBreakdown.reduce((total, item) => total + item.awarded, 0);
  const deviations = scoreBreakdown
    .filter((item) => item.awarded < item.weight)
    .map((item) => `${item.label}: ${item.awarded}/${item.weight}`);
  return result(
    input,
    score,
    quantityCoveragePercent,
    verdictForScore(score),
    deviations,
    score < 100,
    scoreBreakdown,
  );
}

function hardGateFailure(input: CompatibilityEvaluationInput): string | null {
  if (input.candidate.compatibilityStatus === "INCOMPATIBLE_DECOY") {
    return "Каталожная позиция помечена как несовместимая";
  }
  if (input.source.itemKind !== input.candidate.itemKind) return "Не совпадает тип объекта";
  if (input.source.equipmentType !== input.candidate.equipmentType) return "Не совпадает функция оборудования";
  if (input.source.unit !== input.candidate.unit) return "Нет подтверждённой конверсии единиц";
  return null;
}

function hasRequiredTechnicalFacts(item: CompatibilityItem): boolean {
  return Boolean(item.standard && item.materialGrade && item.characteristics.standardCode);
}

function sameCriticalCharacteristics(left: CompatibilityItem, right: CompatibilityItem): boolean {
  const ignored = new Set(["category", "compatibilityStatus", "familyCode", "variantIndex"]);
  return Object.entries(left.characteristics)
    .filter(([key]) => !ignored.has(key))
    .every(([key, value]) => right.characteristics[key] === value);
}

function samePerformanceCharacteristics(left: CompatibilityItem, right: CompatibilityItem): boolean {
  const keys = Object.keys(left.characteristics).filter((key) =>
    /pressure|temperature|range|max|voltage|current|power|speed|class/iu.test(key),
  );
  return keys.every((key) => right.characteristics[key] === left.characteristics[key]);
}

function verdictForScore(score: number): UniversalCompatibilityResult["verdict"] {
  if (score === 100) return "EXACT";
  if (score >= 95) return "COMPATIBLE";
  if (score >= 85) return "CONDITIONAL";
  if (score >= 70) return "ENGINEERING_REVIEW";
  return "NOT_RECOMMENDED";
}

function result(
  input: CompatibilityEvaluationInput,
  score: number | null,
  quantityCoveragePercent: number,
  verdict: UniversalCompatibilityResult["verdict"],
  deviations: readonly string[],
  requiresHumanReview: boolean,
  scoreBreakdown: UniversalCompatibilityResult["scoreBreakdown"],
): UniversalCompatibilityResult {
  return {
    sourceMaterialCode: input.source.materialCode,
    candidateMaterialCode: input.candidate.materialCode,
    technicalCompatibilityPercent: score,
    quantityCoveragePercent,
    verdict,
    scoreBreakdown,
    deviations,
    normativeBasis: input.normativeBasis,
    requiresHumanReview,
    engineVersion: COMPATIBILITY_ENGINE_VERSION,
  };
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

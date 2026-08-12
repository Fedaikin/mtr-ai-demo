import type {
  AnalogueAllocation,
  AnalogueCoverage,
  AnalogueCoveragePlan,
  AnalogueSearchDecision,
  AnalogueVerdict,
  PositionAnalysisResult,
  RuleCitation,
} from "@/domain/models";
import {
  analogueSearchOutcomeLabel,
  analogueVerdictLabel,
  characteristicLabel,
} from "@/lib/localization";

export interface AnalogueComponentView {
  componentIndex: number;
  materialCode: string;
  materialName: string;
  score: number;
  verdict: AnalogueVerdict;
  verdictLabel: string;
  requiredQuantity: number;
  availableQuantity: number;
  allocatedQuantity: number;
  unit: string;
  plant: string;
  warehouse: string;
  remainingAfterReservation: number;
  deviations: Array<{
    characteristic: string;
    characteristicLabel: string;
    required: string;
    available: string;
    deviation: string;
    differs: boolean;
  }>;
  citation: RuleCitation;
  explanation: string;
}

export interface AnaloguePlanView {
  rank: number;
  kind: "PRIMARY" | "ALTERNATIVE";
  coveredQuantity: number;
  shortageQuantity: number;
  complete: boolean;
  combinedCoverage: boolean;
  coverageLabel: string;
  components: AnalogueComponentView[];
}

export interface PositionAnalogueView {
  positionId: string;
  positionCode: string;
  positionName: string;
  reason: string;
  searchOutcome: AnalogueSearchDecision["outcome"] | null;
  searchOutcomeLabel: string | null;
  searchRuleCount: number;
  requiredQuantity: number;
  directCoveredQuantity: number;
  analogueCoveredQuantity: number;
  coveredQuantity: number;
  shortageQuantity: number;
  unit: string;
  complete: boolean;
  combinedCoverage: boolean;
  combinedCoverageLabel: string;
  primary: AnaloguePlanView | null;
  alternatives: AnaloguePlanView[];
  plans: AnaloguePlanView[];
}

const VERDICT_RANK: Record<AnalogueVerdict, number> = {
  SUITABLE: 0,
  REVIEW: 1,
  NOT_RECOMMENDED: 2,
};

export function buildPositionAnalogueViews(
  results: PositionAnalysisResult[],
): PositionAnalogueView[] {
  return results
    .filter(
      (result) =>
        result.match.category === "NO_MATCH" ||
        Boolean(result.analogueCoverage) ||
        Boolean(result.analogueSearch),
    )
    .map((result) => {
      const coverage = result.analogueCoverage;
      const search = result.analogueSearch;
      const requiredQuantity = coverage?.requiredQuantity ?? result.position.requiredQuantity;
      const unit = coverage?.unit ?? result.position.unit;
      const directCoveredQuantity = Math.min(
        requiredQuantity,
        Math.max(
          0,
          coverage?.directCoveredQuantity ??
            search?.directCoveredQuantity ??
            result.match.material?.availableQuantity ??
            0,
        ),
      );
      const plans = coveragePlans(coverage).map(({ plan, kind }, index) =>
        buildPlanView(
          plan,
          kind,
          index + 1,
          requiredQuantity,
          unit,
          directCoveredQuantity,
        ),
      );
      const primary = plans.find((plan) => plan.kind === "PRIMARY") ?? null;
      const coveredQuantity = primary?.coveredQuantity ?? directCoveredQuantity;
      const shortageQuantity = primary?.shortageQuantity
        ?? search?.shortageQuantity
        ?? Math.max(0, requiredQuantity - coveredQuantity);
      const analogueCoveredQuantity = Math.max(0, coveredQuantity - directCoveredQuantity);

      return {
        positionId: result.position.id,
        positionCode: result.position.internalCode,
        positionName: result.position.nameRu,
        reason: analogueReason(result),
        searchOutcome: search?.outcome ?? null,
        searchOutcomeLabel: search ? analogueSearchOutcomeLabel(search.outcome) : null,
        searchRuleCount: search?.ruleCount ?? 0,
        requiredQuantity,
        directCoveredQuantity,
        analogueCoveredQuantity,
        coveredQuantity,
        shortageQuantity,
        unit,
        complete: primary?.complete ?? false,
        combinedCoverage: primary?.combinedCoverage ?? false,
        combinedCoverageLabel: primary?.coverageLabel ?? noCoverageLabel(
          search,
          directCoveredQuantity,
          requiredQuantity,
          shortageQuantity,
        ),
        primary,
        alternatives: plans.filter((plan) => plan.kind === "ALTERNATIVE"),
        plans,
      };
    })
    .toSorted((left, right) => left.positionCode.localeCompare(right.positionCode, "ru"));
}

export function analogueScore(allocation: AnalogueAllocation): number {
  if (allocation.deviations.length === 0) return 100;
  const matching = allocation.deviations.filter((item) => item.deviation === "нет").length;
  return Math.round((matching / allocation.deviations.length) * 100);
}

function coveragePlans(
  coverage: AnalogueCoverage | undefined,
): Array<{ plan: AnalogueCoveragePlan; kind: "PRIMARY" | "ALTERNATIVE" }> {
  if (!coverage) return [];
  const primary = coverage.primaryPlan ?? legacyPrimaryPlan(coverage);
  if (!primary || primary.allocations.length === 0) return [];
  return [
    { plan: primary, kind: "PRIMARY" },
    ...(coverage.alternativePlans ?? [])
      .filter((plan) => plan.allocations.length > 0)
      .map((plan) => ({ plan, kind: "ALTERNATIVE" as const })),
  ];
}

function legacyPrimaryPlan(coverage: AnalogueCoverage): AnalogueCoveragePlan | undefined {
  if (coverage.allocations.length === 0) return undefined;
  return {
    coveredQuantity: coverage.coveredQuantity,
    allocations: coverage.allocations,
    complete: coverage.complete,
  };
}

function buildPlanView(
  plan: AnalogueCoveragePlan,
  kind: "PRIMARY" | "ALTERNATIVE",
  rank: number,
  requiredQuantity: number,
  unit: string,
  directCoveredQuantity: number,
): AnaloguePlanView {
  const allocations = [...plan.allocations]
    .map((allocation) => ({ allocation, score: analogueScore(allocation) }))
    .toSorted((left, right) => {
      const verdict = VERDICT_RANK[left.allocation.verdict] - VERDICT_RANK[right.allocation.verdict];
      if (verdict !== 0) return verdict;
      if (left.score !== right.score) return right.score - left.score;
      if (left.allocation.allocatedQuantity !== right.allocation.allocatedQuantity) {
        return right.allocation.allocatedQuantity - left.allocation.allocatedQuantity;
      }
      return left.allocation.material.materialCode.localeCompare(
        right.allocation.material.materialCode,
        "ru",
      );
    });
  const combinedCoverage = allocations.length > 1;
  const shortageQuantity = Math.max(0, requiredQuantity - plan.coveredQuantity);
  const components = allocations.map(({ allocation, score }, index): AnalogueComponentView => ({
    componentIndex: index + 1,
    materialCode: allocation.material.materialCode,
    materialName: allocation.material.nameRu,
    score,
    verdict: allocation.verdict,
    verdictLabel: analogueVerdictLabel(allocation.verdict),
    requiredQuantity,
    availableQuantity: allocation.allocatedQuantity + allocation.remainingAfterReservation,
    allocatedQuantity: allocation.allocatedQuantity,
    unit,
    plant: allocation.material.plant,
    warehouse: allocation.material.storageLocation,
    remainingAfterReservation: allocation.remainingAfterReservation,
    deviations: allocation.deviations.map((deviation) => ({
      ...deviation,
      characteristicLabel: characteristicLabel(deviation.characteristic),
      differs: deviation.deviation !== "нет",
    })),
    citation: allocation.citation,
    explanation: componentExplanation(
      allocation,
      score,
      requiredQuantity,
      plan.coveredQuantity,
      plan.complete,
      combinedCoverage,
    ),
  }));

  return {
    rank,
    kind,
    coveredQuantity: plan.coveredQuantity,
    shortageQuantity,
    complete: plan.complete,
    combinedCoverage,
    coverageLabel: planCoverageLabel(
      components.map((component) => component.materialCode),
      plan.coveredQuantity,
      requiredQuantity,
      directCoveredQuantity,
    ),
    components,
  };
}

function planCoverageLabel(
  materialCodes: string[],
  coveredQuantity: number,
  requiredQuantity: number,
  directCoveredQuantity: number,
): string {
  const analogueCoveredQuantity = Math.max(0, coveredQuantity - directCoveredQuantity);
  if (directCoveredQuantity > 0) {
    const analogueSource = materialCodes.length > 1
      ? `составной план аналогов ${materialCodes.join(", ")}`
      : materialCodes.length === 1
        ? `аналог ${materialCodes[0]}`
        : "аналоги";
    return `Прямой материал покрывает ${directCoveredQuantity} из ${requiredQuantity}; ${analogueSource} покрывает ещё ${analogueCoveredQuantity}. Совокупно покрыто ${coveredQuantity} из ${requiredQuantity}.`;
  }
  if (materialCodes.length > 1) {
    return `Составной план: материалы ${materialCodes.join(", ")} совместно покрывают ${coveredQuantity} из ${requiredQuantity}.`;
  }
  if (materialCodes.length === 1) {
    return `План с материалом ${materialCodes[0]} покрывает ${coveredQuantity} из ${requiredQuantity}.`;
  }
  return `Подходящее покрытие не найдено: 0 из ${requiredQuantity}.`;
}

function noCoverageLabel(
  search: AnalogueSearchDecision | undefined,
  directCoveredQuantity: number,
  requiredQuantity: number,
  shortageQuantity: number,
): string {
  if (!search) return `Подходящее покрытие не найдено: 0 из ${requiredQuantity}.`;
  const outcome = analogueSearchOutcomeLabel(search.outcome);
  return `Поиск завершён: ${outcome}; прямой материал покрывает ${directCoveredQuantity} из ${requiredQuantity}; незакрытый дефицит — ${shortageQuantity}.`;
}

function analogueReason(result: PositionAnalysisResult): string {
  if (!result.match.material) {
    return "Прямое совпадение в SAP S/4HANA не найдено.";
  }
  const shortage = Math.max(
    0,
    result.position.requiredQuantity - result.match.material.availableQuantity,
  );
  return shortage > 0
    ? `Для прямого материала не хватает ${shortage} ${result.position.unit}.`
    : "Для позиции требуется нормативно подтверждённая замена.";
}

function componentExplanation(
  allocation: AnalogueAllocation,
  score: number,
  requiredQuantity: number,
  coveredQuantity: number,
  complete: boolean,
  combinedCoverage: boolean,
): string {
  const deviationCount = allocation.deviations.filter((item) => item.deviation !== "нет").length;
  const characteristics = deviationCount === 0
    ? "Заявленные характеристики совпадают с требуемыми"
    : `Выявлено отклонений: ${deviationCount}; они показаны в таблице и не скрыты`;
  const quantity = complete
    ? combinedCoverage
      ? `требуемое количество ${requiredQuantity} покрывается совместно компонентами этого плана`
      : `требуемое количество ${requiredQuantity} покрывается этим планом полностью`
    : `этот план покрывает только ${coveredQuantity} из ${requiredQuantity}`;
  return `${characteristics}; соответствие ${score}%. ${quantity}. Допустимость опирается на ${allocation.citation.documentId}, пункт ${allocation.citation.clauseId}.`;
}

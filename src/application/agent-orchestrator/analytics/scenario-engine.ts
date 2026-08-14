import type {
  AnalyticalScenarioAlternative,
  AnalyticalScenarioRun,
  ScenarioCandidate,
} from "@/domain/agent/analytics/artifacts";
import type { DataQualityResult } from "@/domain/agent/analytics/quality";

export interface ScenarioRequest {
  readonly id: string;
  readonly datasetVersion: string;
  readonly createdAt: string;
  readonly requiredQuantity: number;
  readonly unit: string;
  readonly directAvailableQuantity: number;
  readonly candidates: readonly ScenarioCandidate[];
  readonly procurementLeadTimeDays: number;
  readonly dataQuality: DataQualityResult;
}

export function evaluateScenarios(request: ScenarioRequest): AnalyticalScenarioRun {
  const alternatives: AnalyticalScenarioAlternative[] = [];
  const directQuantity = Math.min(request.requiredQuantity, Math.max(0, request.directAvailableQuantity));
  alternatives.push(alternative({
    id: `${request.id}:direct`,
    kind: "DIRECT",
    allocations: directQuantity > 0 ? [{ materialCode: "DIRECT", quantity: directQuantity, unit: request.unit }] : [],
    requiredQuantity: request.requiredQuantity,
    maxLeadTimeDays: 0,
    deviationScore: 0,
    rejectedReasons: directQuantity >= request.requiredQuantity ? [] : ["Прямого остатка недостаточно."],
    evidenceNodeIds: [],
  }));

  const eligible = request.candidates.filter(
    (candidate) =>
      candidate.unit === request.unit &&
      candidate.normativeAllowed &&
      candidate.fresh &&
      candidate.quantity > 0,
  );
  for (const candidate of eligible) {
    const quantity = Math.min(request.requiredQuantity, candidate.quantity);
    alternatives.push(alternative({
      id: `${request.id}:single:${candidate.materialCode}`,
      kind: "SINGLE_SUBSTITUTE",
      allocations: [{ materialCode: candidate.materialCode, quantity, unit: candidate.unit }],
      requiredQuantity: request.requiredQuantity,
      maxLeadTimeDays: candidate.leadTimeDays,
      deviationScore: candidate.deviationScore,
      rejectedReasons: quantity >= request.requiredQuantity ? [] : ["Один аналог не покрывает потребность."],
      evidenceNodeIds: candidate.evidenceNodeIds,
    }));
  }

  const compositeAllocations: { materialCode: string; quantity: number; unit: string }[] = [];
  let remaining = request.requiredQuantity;
  let maxLeadTimeDays = 0;
  let weightedDeviation = 0;
  const compositeEvidence: string[] = [];
  for (const candidate of [...eligible].sort(compareCandidates)) {
    if (remaining <= 0) break;
    const quantity = Math.min(remaining, candidate.quantity);
    compositeAllocations.push({ materialCode: candidate.materialCode, quantity, unit: candidate.unit });
    remaining -= quantity;
    maxLeadTimeDays = Math.max(maxLeadTimeDays, candidate.leadTimeDays);
    weightedDeviation += candidate.deviationScore * quantity;
    compositeEvidence.push(...candidate.evidenceNodeIds);
  }
  alternatives.push(alternative({
    id: `${request.id}:composite`,
    kind: "COMPOSITE_SUBSTITUTE",
    allocations: compositeAllocations,
    requiredQuantity: request.requiredQuantity,
    maxLeadTimeDays,
    deviationScore:
      compositeAllocations.length === 0
        ? 1
        : weightedDeviation /
          compositeAllocations.reduce((sum, allocation) => sum + allocation.quantity, 0),
    rejectedReasons: remaining <= 0 ? [] : ["Комбинация аналогов не покрывает потребность."],
    evidenceNodeIds: [...new Set(compositeEvidence)],
  }));

  alternatives.push(alternative({
    id: `${request.id}:procurement`,
    kind: "PROCUREMENT",
    allocations: [{ materialCode: "PROCUREMENT", quantity: request.requiredQuantity, unit: request.unit }],
    requiredQuantity: request.requiredQuantity,
    maxLeadTimeDays: request.procurementLeadTimeDays,
    deviationScore: 0,
    rejectedReasons: request.procurementLeadTimeDays > 90 ? ["Срок поставки превышает 90 дней."] : [],
    evidenceNodeIds: [],
  }));

  const sorted = alternatives.sort(
    (left, right) =>
      Number(right.feasible) - Number(left.feasible) ||
      right.score - left.score ||
      left.id.localeCompare(right.id),
  );
  const recommended = request.dataQuality.availability === "COMPLETE"
    ? sorted.find((item) => item.feasible) ?? null
    : null;

  return {
    id: request.id,
    schemaVersion: "1.0.0",
    datasetVersion: request.datasetVersion,
    createdAt: request.createdAt,
    requiredQuantity: request.requiredQuantity,
    unit: request.unit,
    alternatives: sorted,
    recommendedAlternativeId: recommended?.id ?? null,
    requiresHumanDecision: true,
    dataQuality: request.dataQuality,
  };
}

function alternative(input: {
  readonly id: string;
  readonly kind: AnalyticalScenarioAlternative["kind"];
  readonly allocations: AnalyticalScenarioAlternative["allocations"];
  readonly requiredQuantity: number;
  readonly maxLeadTimeDays: number;
  readonly deviationScore: number;
  readonly rejectedReasons: readonly string[];
  readonly evidenceNodeIds: readonly string[];
}): AnalyticalScenarioAlternative {
  const coveredQuantity = input.allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
  const remainingShortage = Math.max(0, input.requiredQuantity - coveredQuantity);
  const feasible = remainingShortage === 0 && input.rejectedReasons.length === 0;
  const coverage = input.requiredQuantity > 0 ? Math.min(1, coveredQuantity / input.requiredQuantity) : 0;
  const score = feasible
    ? coverage * 100 - Math.min(50, input.maxLeadTimeDays) * 0.5 - Math.min(1, input.deviationScore) * 25
    : 0;
  return {
    id: input.id,
    kind: input.kind,
    allocations: input.allocations,
    coveredQuantity: round(coveredQuantity),
    remainingShortage: round(remainingShortage),
    maxLeadTimeDays: input.maxLeadTimeDays,
    deviationScore: round(input.deviationScore),
    score: round(score),
    feasible,
    rejectedReasons: input.rejectedReasons,
    evidenceNodeIds: [...new Set(input.evidenceNodeIds)],
  };
}

function compareCandidates(left: ScenarioCandidate, right: ScenarioCandidate): number {
  return left.deviationScore - right.deviationScore ||
    left.leadTimeDays - right.leadTimeDays ||
    left.materialCode.localeCompare(right.materialCode);
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

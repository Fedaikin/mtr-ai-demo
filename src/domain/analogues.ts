import type {
  AnalogueAllocation,
  AnalogueCoverage,
  AnalogueCoveragePlan,
  AnalogueRule,
  Position,
  SapMaterial,
} from "./models";
import { normalizeText, normalizeUnit } from "./normalize";

interface AnalogueCandidate {
  material: SapMaterial;
  rule: AnalogueRule;
  deviations: AnalogueAllocation["deviations"];
  severity: number;
}

const MAX_ALTERNATIVE_PLANS = 3;

export function buildAnalogueCoverage(
  position: Position,
  materials: SapMaterial[],
  rules: AnalogueRule[],
  alreadyReserved: Map<string, number> = new Map(),
): AnalogueCoverage | undefined {
  const applicableRules = rules.filter(
    (rule) => rule.equipmentTypes.includes(position.equipmentType) || rule.equipmentTypes.includes("*"),
  );
  if (applicableRules.length === 0) return undefined;

  const candidates: AnalogueCandidate[] = materials
    .flatMap((material) => {
      if (material.equipmentType !== position.equipmentType) return [];
      if (normalizeUnit(material.unit) !== normalizeUnit(position.unit)) return [];
      const rule = applicableRules.find((candidateRule) => isAllowedByRule(position, material, candidateRule));
      if (!rule) return [];
      const deviations = compareCharacteristics(position, material);
      const severity = deviations.filter((deviation) => deviation.deviation !== "нет").length;
      return [{ material, rule, deviations, severity }];
    })
    .sort((left, right) => {
      if (left.severity !== right.severity) return left.severity - right.severity;
      const requiredManufacturer = normalizeText(position.manufacturer ?? "");
      if (requiredManufacturer) {
        const leftSameManufacturer =
          normalizeText(left.material.manufacturer ?? "") === requiredManufacturer;
        const rightSameManufacturer =
          normalizeText(right.material.manufacturer ?? "") === requiredManufacturer;
        if (leftSameManufacturer !== rightSameManufacturer) {
          return leftSameManufacturer ? -1 : 1;
        }
      }
      return left.material.materialCode.localeCompare(right.material.materialCode, "ru");
    });

  const reservationSnapshot = new Map(alreadyReserved);
  const primaryPlan = allocateCoveragePlan(position, candidates, reservationSnapshot);
  if (!primaryPlan) return undefined;

  const alternativePlans = buildAlternativePlans(
    position,
    candidates,
    primaryPlan,
    reservationSnapshot,
  );

  // Only the selected primary plan consumes the shared cross-position ledger.
  // Alternatives are counterfactual calculations against the same input snapshot.
  for (const allocation of primaryPlan.allocations) {
    const reserved = alreadyReserved.get(allocation.material.id) ?? 0;
    alreadyReserved.set(allocation.material.id, reserved + allocation.allocatedQuantity);
  }

  return {
    requiredQuantity: position.requiredQuantity,
    coveredQuantity: primaryPlan.coveredQuantity,
    unit: position.unit,
    allocations: primaryPlan.allocations,
    complete: primaryPlan.complete,
    primaryPlan,
    alternativePlans,
  };
}

export function extendAnalogueCoverageWithDirectStock(
  coverage: AnalogueCoverage,
  requiredQuantity: number,
  directCoveredQuantity: number,
): AnalogueCoverage {
  const safeDirectQuantity = Math.max(0, Math.min(requiredQuantity, directCoveredQuantity));
  const totalCoverage = (analogueQuantity: number) => safeDirectQuantity + analogueQuantity;
  return {
    ...coverage,
    requiredQuantity,
    directCoveredQuantity: safeDirectQuantity,
    coveredQuantity: totalCoverage(coverage.coveredQuantity),
    complete: totalCoverage(coverage.coveredQuantity) >= requiredQuantity,
    primaryPlan: coverage.primaryPlan
      ? {
          ...coverage.primaryPlan,
          coveredQuantity: totalCoverage(coverage.primaryPlan.coveredQuantity),
          complete: totalCoverage(coverage.primaryPlan.coveredQuantity) >= requiredQuantity,
        }
      : undefined,
    alternativePlans: coverage.alternativePlans?.map((plan) => ({
      ...plan,
      coveredQuantity: totalCoverage(plan.coveredQuantity),
      complete: totalCoverage(plan.coveredQuantity) >= requiredQuantity,
    })),
  };
}

function allocateCoveragePlan(
  position: Position,
  candidates: AnalogueCandidate[],
  reservationSnapshot: ReadonlyMap<string, number>,
): AnalogueCoveragePlan | undefined {
  const planReservations = new Map(reservationSnapshot);
  let remaining = position.requiredQuantity;
  const allocations: AnalogueAllocation[] = [];

  for (const candidate of candidates) {
    if (remaining <= 0) break;
    const reserved = planReservations.get(candidate.material.id) ?? 0;
    const available = Math.max(0, candidate.material.availableQuantity - reserved);
    if (available <= 0) continue;
    const allocatedQuantity = Math.min(remaining, available);
    remaining -= allocatedQuantity;
    planReservations.set(candidate.material.id, reserved + allocatedQuantity);
    allocations.push({
      material: candidate.material,
      allocatedQuantity,
      remainingAfterReservation: available - allocatedQuantity,
      deviations: candidate.deviations,
      verdict: candidate.severity === 0 ? "SUITABLE" : candidate.severity <= 2 ? "REVIEW" : "NOT_RECOMMENDED",
      citation: {
        documentId: candidate.rule.documentId,
        version: candidate.rule.version,
        clauseId: candidate.rule.clauseId,
        title: candidate.rule.title,
        isSyntheticDemo: true,
      },
    });
  }

  if (allocations.length === 0) return undefined;
  return {
    coveredQuantity: position.requiredQuantity - remaining,
    allocations,
    complete: remaining <= 0,
  };
}

function buildAlternativePlans(
  position: Position,
  candidates: AnalogueCandidate[],
  primaryPlan: AnalogueCoveragePlan,
  reservationSnapshot: ReadonlyMap<string, number>,
): AnalogueCoveragePlan[] {
  const primarySignature = planSignature(primaryPlan);
  const seen = new Set([primarySignature]);
  const plans = primaryPlan.allocations.flatMap((primaryAllocation) => {
    const alternative = allocateCoveragePlan(
      position,
      candidates.filter((candidate) => candidate.material.id !== primaryAllocation.material.id),
      reservationSnapshot,
    );
    if (!alternative) return [];
    const signature = planSignature(alternative);
    if (seen.has(signature)) return [];
    seen.add(signature);
    return [alternative];
  });

  return plans
    .toSorted(compareCoveragePlans)
    .slice(0, MAX_ALTERNATIVE_PLANS);
}

function compareCoveragePlans(left: AnalogueCoveragePlan, right: AnalogueCoveragePlan): number {
  if (left.complete !== right.complete) return left.complete ? -1 : 1;
  if (left.coveredQuantity !== right.coveredQuantity) return right.coveredQuantity - left.coveredQuantity;
  const leftDeviations = planDeviationCount(left);
  const rightDeviations = planDeviationCount(right);
  if (leftDeviations !== rightDeviations) return leftDeviations - rightDeviations;
  if (left.allocations.length !== right.allocations.length) {
    return left.allocations.length - right.allocations.length;
  }
  return planSignature(left).localeCompare(planSignature(right), "ru");
}

function planDeviationCount(plan: AnalogueCoveragePlan): number {
  return plan.allocations.reduce(
    (total, allocation) => total + allocation.deviations.filter((item) => item.deviation !== "нет").length,
    0,
  );
}

function planSignature(plan: AnalogueCoveragePlan): string {
  return plan.allocations
    .map((allocation) => `${allocation.material.materialCode}:${allocation.allocatedQuantity}`)
    .toSorted((left, right) => left.localeCompare(right, "ru"))
    .join("|");
}

function isAllowedByRule(position: Position, material: SapMaterial, rule: AnalogueRule): boolean {
  const standardEqual = normalizeText(position.standard ?? "") === normalizeText(material.standard ?? "");
  const standardAllowed = rule.allowedStandardPairs?.some(
    ([required, candidate]) =>
      normalizeText(required) === normalizeText(position.standard ?? "") &&
      normalizeText(candidate) === normalizeText(material.standard ?? ""),
  );
  const materialEqual =
    normalizeText(position.materialGrade ?? "") === normalizeText(material.materialGrade ?? "");
  const materialAllowed = rule.allowedMaterialPairs?.some(
    ([required, candidate]) =>
      normalizeText(required) === normalizeText(position.materialGrade ?? "") &&
      normalizeText(candidate) === normalizeText(material.materialGrade ?? ""),
  );
  if (!standardEqual && !standardAllowed) return false;
  if (!materialEqual && !materialAllowed) return false;

  for (const [key, expected] of Object.entries(position.dimensions)) {
    const actual = material.dimensions[key];
    if (typeof expected !== "number" || typeof actual !== "number") continue;
    const tolerance = rule.dimensionTolerances?.[key] ?? 0;
    if (Math.abs(expected - actual) > tolerance) return false;
  }
  return true;
}

function compareCharacteristics(position: Position, material: SapMaterial) {
  const rows: AnalogueAllocation["deviations"] = [];
  const keys = new Set([
    "standard",
    "materialGrade",
    ...Object.keys(position.dimensions),
    ...Object.keys(material.dimensions),
  ]);
  for (const key of keys) {
    const required =
      key === "standard"
        ? position.standard
        : key === "materialGrade"
          ? position.materialGrade
          : position.dimensions[key];
    const available =
      key === "standard"
        ? material.standard
        : key === "materialGrade"
          ? material.materialGrade
          : material.dimensions[key];
    if (required === undefined && available === undefined) continue;
    rows.push({
      characteristic: key,
      required: String(required ?? "—"),
      available: String(available ?? "—"),
      deviation: normalizeText(String(required ?? "")) === normalizeText(String(available ?? "")) ? "нет" : "есть",
    });
  }
  return rows;
}

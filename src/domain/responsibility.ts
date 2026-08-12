import type { Position, ResponsibilityRule, RuleCitation } from "./models";
import { normalizeText } from "./normalize";

export interface ResponsibilityDecision {
  responsibility: "CUSTOMER" | "CONTRACTOR";
  confidence: number;
  explanation: string;
  citation: RuleCitation;
  requiresHumanReview: boolean;
}

export function classifyResponsibility(
  position: Position,
  rules: ResponsibilityRule[],
): ResponsibilityDecision {
  const candidates = rules
    .filter((rule) => isResponsibilityRuleApplicable(position, rule))
    .sort((left, right) => {
      const specificity = ruleSpecificity(right) - ruleSpecificity(left);
      if (specificity !== 0) return specificity;
      const retrieval =
        (right.retrievalEvidence?.score ?? 0) - (left.retrievalEvidence?.score ?? 0);
      if (retrieval !== 0) return retrieval;
      return citationKey(left).localeCompare(citationKey(right), "ru");
    });
  const selected = candidates[0];
  if (!selected) {
    return {
      responsibility: "CONTRACTOR",
      confidence: 0.45,
      explanation: "Явное демонстрационное правило не найдено; требуется экспертное решение.",
      citation: {
        documentId: "КТ-374-DEMO",
        version: "1.0-DEMO",
        clauseId: "UNRESOLVED",
        title: "Демонстрационное правило не найдено",
        isSyntheticDemo: true,
      },
      requiresHumanReview: true,
    };
  }

  const criticality = position.classification.criticality;
  const requiresHumanReview =
    (criticality === "HIGH" && Boolean(selected.conditions?.expertReviewForCritical)) ||
    reviewConditionMatches(position, selected.conditions?.requiresHumanReviewWhen);
  const configuredConfidence = selected.conditions?.confidence;
  const baseConfidence =
    typeof configuredConfidence === "number" && Number.isFinite(configuredConfidence)
      ? Math.min(1, Math.max(0, configuredConfidence))
      : 0.96;
  return {
    responsibility: selected.responsibility,
    confidence: requiresHumanReview ? Math.min(baseConfidence, 0.82) : baseConfidence,
    explanation: selected.text,
    citation: citationFrom(selected),
    requiresHumanReview,
  };
}

/**
 * Applies the rule's declared business attributes before it can participate in
 * classification. Unknown descriptive metadata is ignored, while supported
 * constraints fail closed when their value differs from the position.
 */
export function isResponsibilityRuleApplicable(
  position: Position,
  rule: ResponsibilityRule,
): boolean {
  if (
    !rule.equipmentTypes.includes(position.equipmentType) &&
    !rule.equipmentTypes.includes("*")
  ) {
    return false;
  }

  const conditions = rule.conditions ?? {};
  if (!matchesCondition(position.standard, conditions.standard)) return false;
  if (!matchesCondition(position.materialGrade, conditions.materialGrade)) return false;
  if (!matchesCondition(position.classification.criticality, conditions.criticality)) return false;
  if (
    !matchesCondition(
      position.classification.procurementGroup,
      conditions.procurementGroup,
    )
  ) {
    return false;
  }
  if (!matchesCondition(position.classification.classCode, conditions.classCode)) return false;

  if (
    isRecord(conditions.classification) &&
    !recordConstraintsMatch(position.classification, conditions.classification)
  ) {
    return false;
  }
  if (
    isRecord(conditions.dimensions) &&
    !dimensionConstraintsMatch(position.dimensions, conditions.dimensions)
  ) {
    return false;
  }
  return true;
}

function ruleSpecificity(rule: ResponsibilityRule): number {
  const conditions = rule.conditions ?? {};
  let score = rule.equipmentTypes.includes("*") ? 0 : 1;
  for (const key of [
    "standard",
    "materialGrade",
    "criticality",
    "procurementGroup",
    "classCode",
  ]) {
    if (conditions[key] !== undefined) score += 1;
  }
  if (isRecord(conditions.classification)) score += Object.keys(conditions.classification).length;
  if (isRecord(conditions.dimensions)) score += Object.keys(conditions.dimensions).length;
  return score;
}

function matchesCondition(actual: unknown, expected: unknown): boolean {
  if (expected === undefined) return true;
  if (Array.isArray(expected)) return expected.some((candidate) => valuesEqual(actual, candidate));
  return valuesEqual(actual, expected);
}

function recordConstraintsMatch(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  return Object.entries(expected).every(([key, value]) => matchesCondition(actual[key], value));
}

function dimensionConstraintsMatch(
  actual: Position["dimensions"],
  expected: Record<string, unknown>,
): boolean {
  return Object.entries(expected).every(([key, constraint]) => {
    const value = actual[key];
    if (isRecord(constraint)) {
      if (typeof value !== "number") return false;
      const minimum = constraint.min;
      const maximum = constraint.max;
      if (typeof minimum === "number" && value < minimum) return false;
      if (typeof maximum === "number" && value > maximum) return false;
      return minimum !== undefined || maximum !== undefined;
    }
    return matchesCondition(value, constraint);
  });
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (typeof left === "number" && typeof right === "number") {
    return Math.abs(left - right) <= 0.0001;
  }
  if (typeof left === "boolean" || typeof right === "boolean") return left === right;
  if (left === undefined || left === null || right === undefined || right === null) {
    return left === right;
  }
  return normalizeText(String(left)) === normalizeText(String(right));
}

function reviewConditionMatches(position: Position, condition: unknown): boolean {
  if (condition === undefined) return false;
  const conditions = Array.isArray(condition) ? condition : [condition];
  return conditions.some((candidate) => {
    const normalized = normalizeText(String(candidate));
    if (normalized === "hazardous area" || normalized === "hazardous area demo") {
      const searchable = normalizeText(
        [
          position.nameRu,
          position.nameEn,
          ...position.synonyms,
          position.classification.classCode,
          position.dimensions.protectionClass === undefined
            ? undefined
            : String(position.dimensions.protectionClass),
        ]
          .filter((value): value is string => Boolean(value))
          .join(" "),
      );
      return /(?:hazardous|explosion|взрыв|\bex\b)/iu.test(searchable);
    }
    return Object.values(position.classification).some((value) =>
      valuesEqual(value, candidate),
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function citationKey(rule: ResponsibilityRule): string {
  return `${rule.documentId}:${rule.version}:${rule.clauseId}`;
}

function citationFrom(rule: ResponsibilityRule): RuleCitation {
  return {
    documentId: rule.documentId,
    version: rule.version,
    clauseId: rule.clauseId,
    title: rule.title,
    isSyntheticDemo: true,
  };
}

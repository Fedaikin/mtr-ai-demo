export const DATA_QUALITY_AVAILABILITY = ["COMPLETE", "PARTIAL", "UNAVAILABLE"] as const;
export type DataQualityAvailability = (typeof DATA_QUALITY_AVAILABILITY)[number];

export interface SourceQualityAssessment {
  readonly sourceSystem: string;
  readonly requestedCount: number;
  readonly resolvedCount: number;
  readonly completeness: number;
  readonly observedAt: string | null;
  readonly ageMinutes: number | null;
  readonly fresh: boolean;
  readonly unitIssueCount: number;
  readonly conflictCount: number;
  readonly unusableFieldCount: number;
}

export interface DataQualityIssue {
  readonly code: string;
  readonly sourceSystem: string | null;
  readonly severity: "INFO" | "WARNING" | "BLOCKING";
  readonly messageRu: string;
}

export interface DataQualityResult {
  readonly availability: DataQualityAvailability;
  readonly completeness: number;
  readonly freshness: "FRESH" | "STALE" | "UNKNOWN";
  readonly confidenceCeiling: number;
  readonly sourceAssessments: readonly SourceQualityAssessment[];
  readonly issues: readonly DataQualityIssue[];
  readonly requiresHumanReview: boolean;
}

export interface DataQualityPolicy {
  readonly minimumCompleteness: number;
  readonly maxAgeMinutes: number;
  readonly requiredSourceSystems: readonly string[];
}

export function assessDataQuality(
  sources: readonly SourceQualityAssessment[],
  policy: DataQualityPolicy,
): DataQualityResult {
  const bySystem = new Map(sources.map((source) => [source.sourceSystem, source]));
  const required = policy.requiredSourceSystems.map((system) => bySystem.get(system));
  const issues: DataQualityIssue[] = [];

  for (const system of policy.requiredSourceSystems) {
    const source = bySystem.get(system);
    if (!source) {
      issues.push({
        code: "SOURCE_UNAVAILABLE",
        sourceSystem: system,
        severity: "BLOCKING",
        messageRu: `Обязательный источник ${system} недоступен.`,
      });
      continue;
    }
    if (source.completeness < policy.minimumCompleteness) {
      issues.push({
        code: "SOURCE_INCOMPLETE",
        sourceSystem: system,
        severity: "WARNING",
        messageRu: `Источник ${system} покрывает не весь запрошенный контур.`,
      });
    }
    if (!source.fresh || source.ageMinutes === null || source.ageMinutes > policy.maxAgeMinutes) {
      issues.push({
        code: "SOURCE_STALE",
        sourceSystem: system,
        severity: "BLOCKING",
        messageRu: `Срез источника ${system} устарел или не датирован.`,
      });
    }
    if (source.unitIssueCount > 0 || source.conflictCount > 0) {
      issues.push({
        code: "SOURCE_CONFLICT",
        sourceSystem: system,
        severity: "BLOCKING",
        messageRu: `В источнике ${system} есть конфликтующие значения или единицы измерения.`,
      });
    }
    if (source.unusableFieldCount > 0) {
      issues.push({
        code: "SOURCE_FIELDS_UNUSABLE",
        sourceSystem: system,
        severity: "WARNING",
        messageRu: `В источнике ${system} есть непригодные для расчёта поля.`,
      });
    }
  }

  const presentRequired = required.filter(
    (source): source is SourceQualityAssessment => source !== undefined,
  );
  const completeness =
    policy.requiredSourceSystems.length === 0
      ? 0
      : presentRequired.reduce((sum, source) => sum + normalized(source.completeness), 0) /
        policy.requiredSourceSystems.length;
  const hasBlocking = issues.some((issue) => issue.severity === "BLOCKING");
  const hasMissingSource = presentRequired.length !== policy.requiredSourceSystems.length;
  const availability: DataQualityAvailability = hasMissingSource
    ? "UNAVAILABLE"
    : hasBlocking || completeness < 1
      ? "PARTIAL"
      : "COMPLETE";
  const freshness = hasMissingSource
    ? "UNKNOWN"
    : presentRequired.every(
          (source) =>
            source.fresh &&
            source.ageMinutes !== null &&
            source.ageMinutes <= policy.maxAgeMinutes,
        )
      ? "FRESH"
      : "STALE";
  const qualityPenalty = issues.reduce(
    (sum, issue) => sum + (issue.severity === "BLOCKING" ? 0.25 : issue.severity === "WARNING" ? 0.1 : 0),
    0,
  );
  const confidenceCeiling = availability === "UNAVAILABLE"
    ? 0
    : normalized(Math.min(completeness, 1 - qualityPenalty));

  return {
    availability,
    completeness,
    freshness,
    confidenceCeiling,
    sourceAssessments: sources,
    issues,
    requiresHumanReview: availability !== "COMPLETE" || issues.length > 0,
  };
}

function normalized(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

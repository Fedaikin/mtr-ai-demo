export const UNIVERSAL_PUBLIC_SCHEMA_VERSION = "universal-agent-answer-public-v1" as const;

export interface PublicUniversalAnswer {
  readonly schemaVersion: typeof UNIVERSAL_PUBLIC_SCHEMA_VERSION;
  readonly kind: "ANSWER";
  readonly summary: string;
  readonly facts: readonly Readonly<{
    label: string;
    value: string | number;
    unit: string | null;
    statusLabel: string | null;
  }>[];
  readonly tables: readonly Readonly<{
    title: string;
    columns: readonly string[];
    rows: readonly Readonly<Record<string, string | number | null>>[];
    totalRows: number;
  }>[];
  readonly risks: readonly Readonly<{
    levelLabel: string;
    title: string;
    explanation: string;
  }>[];
  readonly compatibility: readonly Readonly<{
    sourceMaterialCode: string;
    candidateMaterialCode: string;
    technicalCompatibilityPercent: number | null;
    quantityCoveragePercent: number;
    verdictLabel: string;
    deviations: readonly string[];
    normativeBasis: string | null;
    requiresHumanReview: boolean;
  }>[];
  readonly recommendations: readonly Readonly<{
    kindLabel: string;
    title: string;
    explanation: string;
    quantity: number | null;
    unit: string | null;
    residualRisk: string;
  }>[];
  readonly actions: readonly Readonly<{
    title: string;
    enabled: boolean;
    requiresConfirmation: boolean;
  }>[];
  readonly limitations: readonly Readonly<{
    status: "NOT_FOUND" | "UNAVAILABLE" | "PARTIAL" | "REVIEW_REQUIRED";
    message: string;
    impact: string;
  }>[];
  readonly confidence: number;
  readonly requiresHumanReview: boolean;
  readonly generatedAt: string;
}

export interface PublicUniversalClarification {
  readonly schemaVersion: typeof UNIVERSAL_PUBLIC_SCHEMA_VERSION;
  readonly kind: "CLARIFICATION";
  readonly question: string;
  readonly candidates: readonly Readonly<{
    kindLabel: string;
    code: string;
    name: string;
  }>[];
}

export type PublicUniversalResult = PublicUniversalAnswer | PublicUniversalClarification;

export function projectUniversalAgentOutput(value: unknown): PublicUniversalResult | null {
  const root = record(value);
  if (!root || root.schemaVersion !== "universal-agent-answer-v1") return null;
  const output = record(root.output);
  if (!output) return null;
  if (output.kind === "ASK_CLARIFICATION") {
    return {
      schemaVersion: UNIVERSAL_PUBLIC_SCHEMA_VERSION,
      kind: "CLARIFICATION",
      question: text(output.question, 500, "Уточните запрос."),
      candidates: array(output.candidates, 8).flatMap((candidate) => {
        const item = record(candidate);
        if (!item) return [];
        return [{
          kindLabel: entityKindLabel(item.kind),
          code: text(item.code, 200),
          name: text(item.name, 300),
        }];
      }),
    };
  }

  const confidence = number(output.confidence, 0, 1);
  if (confidence === null || typeof output.requiresHumanReview !== "boolean") return null;
  return {
    schemaVersion: UNIVERSAL_PUBLIC_SCHEMA_VERSION,
    kind: "ANSWER",
    summary: text(output.summary, 1_000, "Ответ сформирован по доступным данным."),
    facts: array(output.facts, 24).flatMap((fact) => {
      const item = record(fact);
      if (!item || !factScalar(item.value)) return [];
      return [{
        label: text(item.label, 200),
        value: item.value,
        unit: nullableText(item.unit, 40),
        statusLabel: factStatusLabel(item.status),
      }];
    }),
    tables: array(output.tables, 8).flatMap((table) => {
      const item = record(table);
      if (!item) return [];
      const columns = array(item.columns, 12).flatMap((column) =>
        typeof column === "string" ? [column.slice(0, 160)] : []);
      if (!columns.length) return [];
      return [{
        title: text(item.title, 240, "Данные"),
        columns,
        rows: array(item.rows, 50).flatMap((row) => {
          const source = record(row);
          if (!source) return [];
          const safe: Record<string, string | number | null> = {};
          for (const column of columns) {
            const value = source[column];
            safe[column] = scalar(value) ? value : null;
          }
          return [safe];
        }),
        totalRows: integer(item.totalRows, 0, 1_000_000),
      }];
    }),
    risks: array(output.risks, 16).flatMap((risk) => {
      const item = record(risk);
      if (!item) return [];
      return [{
        levelLabel: riskLevelLabel(item.level),
        title: text(item.title, 240, "Риск"),
        explanation: text(item.explanation, 800),
      }];
    }),
    compatibility: array(output.compatibility, 20).flatMap((candidate) => {
      const item = record(candidate);
      if (!item) return [];
      const coverage = number(item.quantityCoveragePercent, 0, 100);
      const technical = item.technicalCompatibilityPercent === null
        ? null
        : number(item.technicalCompatibilityPercent, 0, 100);
      if (coverage === null || (item.technicalCompatibilityPercent !== null && technical === null)) return [];
      return [{
        sourceMaterialCode: text(item.sourceMaterialCode, 200),
        candidateMaterialCode: text(item.candidateMaterialCode, 200),
        technicalCompatibilityPercent: technical,
        quantityCoveragePercent: coverage,
        verdictLabel: compatibilityVerdictLabel(item.verdict),
        deviations: stringArray(item.deviations, 12, 300),
        normativeBasis: nullableText(item.normativeBasis, 500),
        requiresHumanReview: item.requiresHumanReview !== false,
      }];
    }),
    recommendations: array(output.recommendations, 16).flatMap((recommendation) => {
      const item = record(recommendation);
      if (!item) return [];
      return [{
        kindLabel: recommendationKindLabel(item.kind),
        title: text(item.title, 240, "Рекомендация"),
        explanation: text(item.explanation, 800),
        quantity: item.quantity === undefined ? null : number(item.quantity, 0, 1_000_000_000),
        unit: nullableText(item.unit, 40),
        residualRisk: text(item.residualRisk, 500),
      }];
    }),
    actions: array(output.actions, 12).flatMap((action) => {
      const item = record(action);
      if (!item) return [];
      return [{
        title: text(item.title, 300, "Доступное действие"),
        enabled: item.enabled === true,
        requiresConfirmation: item.requiresConfirmation !== false,
      }];
    }),
    limitations: array(output.missingData, 16).flatMap((missing) => {
      const item = record(missing);
      if (!item) return [];
      return [{
        status: publicLimitationStatus(item.code),
        message: text(item.message, 500, "Часть данных недоступна."),
        impact: text(item.impact, 500),
      }];
    }),
    confidence,
    requiresHumanReview: output.requiresHumanReview,
    generatedAt: typeof output.generatedAt === "string" ? output.generatedAt.slice(0, 40) : "",
  };
}

export function restorePublicUniversalResult(value: unknown): PublicUniversalResult | null {
  const root = record(value);
  if (!root || root.schemaVersion !== UNIVERSAL_PUBLIC_SCHEMA_VERSION) return null;
  if (root.kind === "CLARIFICATION") {
    return {
      schemaVersion: UNIVERSAL_PUBLIC_SCHEMA_VERSION,
      kind: "CLARIFICATION",
      question: text(root.question, 500, "Уточните запрос."),
      candidates: array(root.candidates, 8).flatMap((candidate) => {
        const item = record(candidate);
        return item ? [{
          kindLabel: text(item.kindLabel, 120, "Объект"),
          code: text(item.code, 200),
          name: text(item.name, 300),
        }] : [];
      }),
    };
  }
  if (root.kind !== "ANSWER") return null;
  // The public schema is already a whitelist. Re-projecting it through the
  // same function would require the private envelope, so validate by wrapping
  // only the safe public fields in their source-shaped equivalents.
  return projectUniversalAgentOutput({
    schemaVersion: "universal-agent-answer-v1",
    output: {
      summary: root.summary,
      facts: array(root.facts, 24).map((item) => {
        const value = record(item) ?? {};
        return {
          label: value.label,
          value: value.value,
          unit: value.unit,
          status: publicFactStatus(value.statusLabel),
        };
      }),
      tables: root.tables,
      risks: array(root.risks, 16).map((item) => {
        const value = record(item) ?? {};
        return { level: publicRiskLevel(value.levelLabel), title: value.title, explanation: value.explanation };
      }),
      compatibility: array(root.compatibility, 20).map((item) => {
        const value = record(item) ?? {};
        return {
          ...value,
          verdict: publicCompatibilityVerdict(value.verdictLabel),
        };
      }),
      recommendations: array(root.recommendations, 16).map((item) => {
        const value = record(item) ?? {};
        return { ...value, kind: publicRecommendationKind(value.kindLabel), quantity: value.quantity ?? undefined };
      }),
      actions: root.actions,
      missingData: array(root.limitations, 16).map((item) => {
        const value = record(item) ?? {};
        return {
          code: privateLimitationCode(value.status),
          message: value.message,
          impact: value.impact,
        };
      }),
      confidence: root.confidence,
      requiresHumanReview: root.requiresHumanReview,
      generatedAt: root.generatedAt,
    },
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function array(value: unknown, max: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function scalar(value: unknown): value is string | number | null {
  return value === null || typeof value === "string" || typeof value === "number" && Number.isFinite(value);
}

function factScalar(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number" && Number.isFinite(value);
}

function text(value: unknown, max: number, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}

function nullableText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function stringArray(value: unknown, max: number, itemMax: number): string[] {
  return array(value, max).flatMap((item) =>
    typeof item === "string" && item.trim() ? [item.trim().slice(0, itemMax)] : []);
}

function number(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function integer(value: unknown, min: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : 0;
}

function entityKindLabel(value: unknown): string {
  return { BUSINESS_PROJECT: "Бизнес-проект", SPECIFICATION: "Спецификация", MATERIAL: "Материал", POSITION: "Позиция", WAREHOUSE: "Склад" }[String(value)] ?? "Объект";
}

function factStatusLabel(value: unknown): string | null {
  return { NORMAL: "Норма", ATTENTION: "Требует внимания", CRITICAL: "Критично", UNKNOWN: "Не определено" }[String(value)] ?? null;
}

function riskLevelLabel(value: unknown): string {
  return { LOW: "Низкий", MEDIUM: "Средний", HIGH: "Высокий", CRITICAL: "Критический" }[String(value)] ?? "Не определён";
}

function compatibilityVerdictLabel(value: unknown): string {
  return {
    EXACT: "Точное соответствие",
    COMPATIBLE: "Совместимо",
    CONDITIONAL: "Условно совместимо",
    ENGINEERING_REVIEW: "Требуется инженерная проверка",
    NOT_RECOMMENDED: "Не рекомендуется",
    PROHIBITED: "Запрещено",
    INSUFFICIENT_DATA: "Недостаточно данных",
  }[String(value)] ?? "Недостаточно данных";
}

function recommendationKindLabel(value: unknown): string {
  return { REORDER: "Дозаказ", REPLACEMENT: "Замена", EXPERT_REVIEW: "Экспертная проверка", MONITOR: "Мониторинг" }[String(value)] ?? "Рекомендация";
}

function publicLimitationStatus(value: unknown): PublicUniversalAnswer["limitations"][number]["status"] {
  const code = String(value);
  if (/(?:^|_)NOT_FOUND$/u.test(code)) return "NOT_FOUND";
  if (/(?:DENIED|REVIEW|AMBIGUOUS|VALIDATION)/u.test(code)) return "REVIEW_REQUIRED";
  if (/(?:PARTIAL|INCOMPLETE|STALE)/u.test(code)) return "PARTIAL";
  return "UNAVAILABLE";
}

function privateLimitationCode(value: unknown): string {
  return {
    NOT_FOUND: "MATERIAL_NOT_FOUND",
    UNAVAILABLE: "PUBLIC_DATA_UNAVAILABLE",
    PARTIAL: "PUBLIC_PARTIAL_DATA",
    REVIEW_REQUIRED: "PUBLIC_REVIEW_REQUIRED",
  }[String(value)] ?? "PUBLIC_DATA_UNAVAILABLE";
}

function publicRiskLevel(value: unknown): string {
  return { Низкий: "LOW", Средний: "MEDIUM", Высокий: "HIGH", Критический: "CRITICAL" }[String(value)] ?? "LOW";
}

function publicFactStatus(value: unknown): string | null {
  return { Норма: "NORMAL", "Требует внимания": "ATTENTION", Критично: "CRITICAL", "Не определено": "UNKNOWN" }[String(value)] ?? null;
}

function publicCompatibilityVerdict(value: unknown): string {
  const entries: Record<string, string> = {
    "Точное соответствие": "EXACT",
    "Совместимо": "COMPATIBLE",
    "Условно совместимо": "CONDITIONAL",
    "Требуется инженерная проверка": "ENGINEERING_REVIEW",
    "Не рекомендуется": "NOT_RECOMMENDED",
    "Запрещено": "PROHIBITED",
    "Недостаточно данных": "INSUFFICIENT_DATA",
  };
  return entries[String(value)] ?? "INSUFFICIENT_DATA";
}

function publicRecommendationKind(value: unknown): string {
  return { Дозаказ: "REORDER", Замена: "REPLACEMENT", "Экспертная проверка": "EXPERT_REVIEW", Мониторинг: "MONITOR" }[String(value)] ?? "MONITOR";
}

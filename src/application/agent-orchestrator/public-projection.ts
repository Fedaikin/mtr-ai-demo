import { containsInternalAgentContent } from "@/application/agent-presentation";
import type { AgentOrchestratorCommandResult } from "@/ports/agent-orchestrator";

const RESPONSE_TYPE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  ANSWER: "Ответ МТР-агента",
  POSITION_ANALYSIS: "Анализ позиции",
  SPECIFICATION_ANALYSIS: "Анализ спецификации",
  SUMMARY: "Оперативная сводка",
  MY_TASKS: "Мои задачи",
  TASK_LIST: "Мои задачи",
  KPI: "KPI и SLA",
  RISKS: "Риски",
  RISK_LIST: "Список рисков",
  STOCKS: "Остатки",
  STOCK_LIST: "Остатки",
  ACTION_PROPOSAL: "Предложенное действие",
});

const STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  DRAFT: "Черновик",
  GATHERING_DATA: "Сбор данных",
  ANALYZED: "Анализ завершён",
  NEEDS_REVIEW: "Требуется проверка",
  READY: "Готово",
  BLOCKED: "Заблокировано",
  CLOSED: "Закрыто",
  COMPLETE: "Результат сформирован",
  PARTIAL: "Доступен частичный результат",
  UNAVAILABLE: "Результат временно недоступен",
  PENDING: "Ожидает выполнения",
  QUEUED: "В очереди",
  RUNNING: "Выполняется",
  SUCCEEDED: "Выполнено успешно",
  FAILED: "Ошибка выполнения",
  CANCELLED: "Отменено",
  EXPIRED: "Срок действия истёк",
  AWAITING_ACCEPTANCE: "Ожидает принятия",
  IN_PROGRESS: "В работе",
  REQUIRES_DECISION: "Требуется решение",
  RETURNED_FOR_CLARIFICATION: "Возвращено на уточнение",
  COMPLETED: "Выполнено",
  FOUND: "Найдено на складе",
  PROCUREMENT: "Требуется закупка",
  NO_MATCH: "Совпадение не найдено",
});

const RISK_LEVEL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  LOW: "Низкий риск",
  MEDIUM: "Средний риск",
  HIGH: "Высокий риск",
  CRITICAL: "Критический риск",
});

const SOURCE_SYSTEM_LABELS: Readonly<Record<string, string>> = Object.freeze({
  APPIUS: "Appius PLM",
  SAP: "SAP S/4HANA",
  CATALOG: "Промышленный каталог",
  NORMATIVE: "Нормативная база",
  SCENARIO: "Сценарий анализа",
  REPORT: "Отчёт",
  PROCESS_EVENT: "События процесса",
  PROCESS_ENGINE: "Процесс анализа",
  MATERIAL_MOVEMENT: "Движения материалов",
  TECHNICAL_SAMPLE: "Технические измерения",
  TASKS: "Сервис задач",
  TASK_STORE: "Сервис задач",
  METRICS: "Сервис метрик",
  METRIC_REGISTRY: "Реестр метрик",
  RISKS: "Сервис рисков",
  RISK_ENGINE: "Сервис рисков",
  LLM: "Языковая модель",
});

const FRESHNESS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  FRESH: "Актуальные данные",
  AGING: "Срок актуальности истекает",
  STALE: "Данные устарели",
  UNKNOWN: "Актуальность не подтверждена",
});

const AVAILABILITY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  AVAILABLE: "Доступно",
  SLOW: "Доступно с задержкой",
  DEGRADED: "Работает с ограничениями",
  PARTIAL: "Доступно частично",
  UNAVAILABLE: "Временно недоступно",
  ACCESS_DENIED: "Доступ запрещён",
  RATE_LIMITED: "Временно ограничено",
  UNKNOWN: "Доступность не определена",
});

const TECHNICAL_PUBLIC_TEXT_PATTERN =
  /\b(?:Evidence|tool\s*calls?|raw\s*JSON|internal\s*reasoning)\b/iu;
const SAFE_HIDDEN_ANSWER =
  "Технические сведения ответа скрыты. Повторите запрос или передайте результат специалисту.";

export interface PublicAgentSource {
  readonly sourceLabel: string;
  readonly entityId: string | null;
  readonly versionOrSnapshot: string | null;
  readonly clauseId: string | null;
  readonly freshnessLabel: string;
  readonly availabilityLabel: string;
  readonly href: string | null;
  readonly canOpen: boolean;
}

export interface PublicAgentCommandResult {
  readonly schemaVersion: "mtr-agent-command-public-v1";
  readonly messageId: string;
  readonly responseLabel: string;
  readonly statusLabel: string;
  readonly answer: string;
  readonly riskLabel: string | null;
  readonly confidence: number | null;
  readonly requiresHumanReview: boolean;
  readonly technicalContentRemoved: boolean;
  readonly generatedAt: string | null;
  readonly sources: readonly PublicAgentSource[];
}

export function responseTypeLabel(value: unknown): string {
  return knownLabel(RESPONSE_TYPE_LABELS, value, "Результат МТР-агента");
}

export function statusLabel(value: unknown): string {
  return knownLabel(STATUS_LABELS, value, "Статус не определён");
}

export function riskLevelLabel(value: unknown): string {
  return knownLabel(RISK_LEVEL_LABELS, value, "Уровень риска не определён");
}

export function sourceSystemLabel(value: unknown): string {
  return knownLabel(SOURCE_SYSTEM_LABELS, value, "Источник данных");
}

export function freshnessLabel(value: unknown): string {
  return knownLabel(FRESHNESS_LABELS, value, "Актуальность не подтверждена");
}

export function availabilityLabel(value: unknown): string {
  return knownLabel(AVAILABILITY_LABELS, value, "Доступность не определена");
}

/**
 * Fail-closed projection at the application boundary. Only explicitly listed
 * fields survive; tool calls, evidence payloads, raw JSON and unknown enums do
 * not become part of the object consumed by the UI.
 */
export function toPublicAgentCommandResult(input: unknown): PublicAgentCommandResult {
  const record = asRecord(input);
  const answer = safeDisplayText(record?.answer, 8_000);
  const technicalContentRemoved =
    answer === null ||
    containsInternalAgentContent(answer) ||
    TECHNICAL_PUBLIC_TEXT_PATTERN.test(answer);
  const riskWasProvided = record !== null && record.riskLevel !== undefined && record.riskLevel !== null;

  return Object.freeze({
    schemaVersion: "mtr-agent-command-public-v1",
    messageId: safeIdentifier(record?.messageId),
    responseLabel: responseTypeLabel(record?.responseType),
    statusLabel: statusLabel(record?.status),
    answer: technicalContentRemoved ? SAFE_HIDDEN_ANSWER : answer,
    riskLabel: riskWasProvided ? riskLevelLabel(record?.riskLevel) : null,
    confidence: safeConfidence(record?.confidence),
    requiresHumanReview:
      technicalContentRemoved || record?.requiresHumanReview !== false,
    technicalContentRemoved,
    generatedAt: safeIsoTimestamp(record?.generatedAt),
    sources: Object.freeze(projectSources(record?.sources)),
  });
}

/**
 * Converts a trusted domain command result into the narrow input accepted by
 * the fail-closed public projector. No command items, filters or internal
 * evidence payloads cross this boundary.
 */
export function projectAgentCommandResult(
  result: AgentOrchestratorCommandResult,
  messageId: string,
): PublicAgentCommandResult {
  const riskLevel = result.responseType === "RISKS"
    ? highestRiskLevel(result.items.map((item) => item.level))
    : null;
  return toPublicAgentCommandResult({
    messageId,
    responseType: result.responseType,
    status: result.missingData.length > 0 || result.requiresHumanReview ? "PARTIAL" : "COMPLETE",
    answer: result.summary,
    riskLevel,
    confidence: result.confidence,
    requiresHumanReview: result.requiresHumanReview,
    generatedAt: result.generatedAt,
    sources: result.citations.map((citation) => ({
      accessible: true,
      sourceSystem: citation.sourceSystem,
      entityId: citation.entityId,
      versionOrSnapshot: citation.sourceSnapshot,
      clauseId: citation.clauseId ?? null,
      freshness: citationFreshness(citation.observedAt),
      availability: "AVAILABLE",
      href: citationHref(citation.sourceSystem, citation.entityId),
    })),
  });
}

function projectSources(value: unknown): PublicAgentSource[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((item) => projectSource(item));
}

function projectSource(value: unknown): PublicAgentSource {
  const record = asRecord(value);
  const accessible = record?.accessible === true;
  if (!accessible) {
    return Object.freeze({
      sourceLabel: "Источник больше недоступен",
      entityId: null,
      versionOrSnapshot: null,
      clauseId: null,
      freshnessLabel: freshnessLabel("UNKNOWN"),
      availabilityLabel: availabilityLabel("ACCESS_DENIED"),
      href: null,
      canOpen: false,
    });
  }

  const href = safeInternalHref(record.href);
  return Object.freeze({
    sourceLabel: sourceSystemLabel(record.sourceSystem),
    entityId: safeDisplayText(record.entityId, 300),
    versionOrSnapshot: safeDisplayText(record.versionOrSnapshot, 300),
    clauseId: safeDisplayText(record.clauseId, 200),
    freshnessLabel: freshnessLabel(record.freshness),
    availabilityLabel: availabilityLabel(record.availability),
    href,
    canOpen: href !== null,
  });
}

function knownLabel(
  labels: Readonly<Record<string, string>>,
  value: unknown,
  fallback: string,
): string {
  if (typeof value !== "string") return fallback;
  return labels[value.toLocaleUpperCase("en-US")] ?? fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function safeIdentifier(value: unknown): string {
  if (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
  ) return value;
  return "agent-result";
}

function safeDisplayText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return null;
  if (containsInternalAgentContent(normalized) || TECHNICAL_PUBLIC_TEXT_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

function safeConfidence(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function safeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

function safeInternalHref(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\r\n]/u.test(value)
  ) return null;
  return value;
}

function highestRiskLevel(values: readonly string[]): string | null {
  const weight: Readonly<Record<string, number>> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
  return values.reduce<string | null>((highest, value) =>
    (weight[value] ?? 0) > (highest ? weight[highest] ?? 0 : 0) ? value : highest, null);
}

function citationFreshness(observedAt: string): "FRESH" | "AGING" | "STALE" | "UNKNOWN" {
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(observed)) return "UNKNOWN";
  const age = Date.now() - observed;
  if (age < 0) return "UNKNOWN";
  if (age <= 24 * 60 * 60_000) return "FRESH";
  if (age <= 7 * 24 * 60 * 60_000) return "AGING";
  return "STALE";
}

function citationHref(sourceSystem: string, entityId: string): string | null {
  const id = encodeURIComponent(entityId);
  if (sourceSystem === "APPIUS" && /^spec-/u.test(entityId)) return `/specifications/${id}`;
  if (sourceSystem === "SAP" && /^SAP-DEMO-/u.test(entityId)) return `/materials/${id}`;
  if (sourceSystem === "PROCESS_ENGINE" && /^run-/u.test(entityId)) return `/runs/${id}`;
  if (sourceSystem === "TASK_STORE" && /^review-/u.test(entityId)) return `/mtr-analysis?review=${id}`;
  return null;
}

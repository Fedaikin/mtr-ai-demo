import "server-only";

import type { MtrRepository } from "@/adapters/persistence/repository";
import type { AgentExecutionContext } from "@/domain/agent/context";
import type { AgentCitation, AgentEvidence, AgentMissingData } from "@/domain/agent/evidence";
import type {
  AgentRisk,
  KpiCalculationQuery,
  KpiDrillDownItem,
  KpiMetric,
  RiskEvaluationQuery,
} from "@/ports/agent-orchestrator";

const DAY_MS = 24 * 60 * 60_000;
const MIN_FORECAST_WEEKS = 8;
const DEFAULT_PERIOD_DAYS = 90;
const KPI_DEFINITIONS = Object.freeze({
  ANALYSIS_COMPLETION_RATE: {
    version: "analysis-completion-rate-v1",
    formula: "завершённые анализы / начатые анализы × 100",
    unit: "%",
    target: 95,
  },
  EXPERT_REVIEW_SHARE: {
    version: "expert-review-share-v1",
    formula: "назначенные экспертные проверки / завершённые анализы × 100",
    unit: "%",
    target: 30,
  },
  BUSINESS_CYCLE_TIME: {
    version: "business-cycle-time-v1",
    formula: "сумма длительности завершённых анализов / число завершённых анализов",
    unit: "ч",
    target: 4,
  },
  STOCK_COVERAGE: {
    version: "stock-coverage-v1",
    formula: "позиции с покрытием расхода на 30 дней / позиции с сопоставимой историей × 100",
    unit: "%",
    target: 90,
  },
} as const);

export class RuntimeAgentAnalyticsService {
  constructor(
    private readonly repository: MtrRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async calculateKpi(
    context: AgentExecutionContext,
    query: KpiCalculationQuery,
  ): Promise<{ readonly metrics: readonly KpiMetric[]; readonly evidence: AgentEvidence }> {
    assertScope(context, query.selection.projectId);
    const period = requestedPeriod(query.selection.period, this.now(), DEFAULT_PERIOD_DAYS);
    const previousPeriod = previous(period);
    const requested = query.metricKeys?.length
      ? [...new Set(query.metricKeys)]
      : Object.keys(KPI_DEFINITIONS);
    const missingData: AgentMissingData[] = [];
    const metrics: KpiMetric[] = [];
    const events = await this.repository.listAgentMetricEvents(context.trusted.subjectId, {
      projectId: query.selection.projectId,
      from: previousPeriod.from,
      to: period.to,
    });

    for (const metricKey of requested) {
      if (!(metricKey in KPI_DEFINITIONS)) {
        missingData.push({ code: "KPI_DEFINITION_UNKNOWN", message: "Определение показателя не найдено" });
        continue;
      }
      if (metricKey === "STOCK_COVERAGE") {
        if (!context.trusted.permissionKeys.has("stock.search") || query.warehouseIds.length === 0) {
          missingData.push({ code: "KPI_STOCK_SCOPE_UNAVAILABLE", message: "Нет доступа к складской области показателя" });
          continue;
        }
        const metric = await this.stockCoverage(context, query, period, previousPeriod);
        if (metric) metrics.push(metric);
        else missingData.push({ code: "KPI_STOCK_HISTORY_INSUFFICIENT", message: "Недостаточно сопоставимой истории движений" });
        continue;
      }
      const metric = processMetric(metricKey, events, period, previousPeriod);
      if (metric) metrics.push(metric);
      else missingData.push({ code: "KPI_PROCESS_EVENTS_INSUFFICIENT", message: "Недостаточно процессных событий для показателя" });
    }

    const citations = distinctCitations(metrics.flatMap((metric) => metric.drillDown));
    const complete = metrics.length === requested.length && missingData.length === 0;
    const requestedScope = [
      `project:${query.selection.projectId}`,
      `period:${period.from}/${period.to}`,
      ...requested.map((key) => `metric:${key}`),
      ...query.warehouseIds.map((id) => `warehouse:${id}`),
    ];
    return {
      metrics,
      evidence: {
        availability: complete ? "COMPLETE" : metrics.length > 0 ? "PARTIAL" : "UNAVAILABLE",
        confidence: complete && citations.length > 0 ? 0.9 : metrics.length > 0 ? 0.6 : 0,
        coverage: { requestedScope, checkedScope: complete ? requestedScope : [], complete },
        citations,
        missingData,
      },
    };
  }

  async evaluateRisks(
    context: AgentExecutionContext,
    query: RiskEvaluationQuery,
  ): Promise<{ readonly items: readonly AgentRisk[]; readonly evidence: AgentEvidence }> {
    assertScope(context, query.selection.projectId);
    const horizonDays = query.horizonDays ?? 90;
    const to = this.now().toISOString();
    const fromDate = new Date(this.now());
    fromDate.setUTCDate(fromDate.getUTCDate() - 12 * 7);
    const warehouseIds = context.trusted.permissionKeys.has("stock.search")
      ? context.warehouseScopeIds
      : [];
    const missingData: AgentMissingData[] = [];
    const risks: AgentRisk[] = [];
    const citations: AgentCitation[] = [];

    const sapState = await this.repository.getIntegrationState(context.trusted.subjectId, "SAP");
    if (sapState?.snapshotAt) {
      const ageDays = Math.floor((this.now().valueOf() - Date.parse(sapState.snapshotAt)) / DAY_MS);
      if (Number.isFinite(ageDays) && ageDays > 1) {
        const score = Math.min(100, 45 + ageDays * 3);
        risks.push(risk({
          id: "risk-sap-snapshot-stale",
          level: levelForScore(score),
          score,
          horizonDays: 0,
          objectType: "SOURCE",
          objectId: "SAP",
          summary: `Снимок SAP не обновлялся ${ageDays} дн.`,
          factors: [`Возраст снимка: ${ageDays} дн.`],
          impact: "Оценка покрытия и дефицита может быть устаревшей.",
          recommendedActions: ["Обновить снимок SAP перед решением по дефициту."],
          confidence: 1,
          ruleVersion: "sap-freshness-risk-v1",
          requiresHumanReview: true,
        }));
        citations.push({
          sourceKind: "STOCK_SNAPSHOT",
          sourceSystem: "SAP",
          entityId: "SAP",
          sourceSnapshot: sapState.snapshotAt,
          observedAt: sapState.snapshotAt,
        });
      }
    }

    if (warehouseIds.length > 0) {
      const [movements, stock] = await Promise.all([
        this.repository.listMaterialMovements(context.trusted.subjectId, {
          projectId: query.selection.projectId,
          warehouseIds,
          from: fromDate.toISOString(),
          to,
        }),
        this.repository.searchSapMaterials(context.trusted.subjectId, {
          warehouseIds,
          limit: 500,
        }),
      ]);
      const forecasts = forecastMaterials(movements, stock.items, horizonDays);
      const comparableHistory = hasComparableHistory(movements, stock.items);
      if (comparableHistory) citations.push(...movements.slice(-60).map(movementCitation));
      for (const forecast of forecasts) {
        risks.push(risk({
          id: `risk-exhaustion:${forecast.materialCode}:${forecast.warehouseId}`,
          level: levelForScore(forecast.score),
          score: forecast.score,
          horizonDays: forecast.daysUntilExhaustion,
          objectType: "MATERIAL",
          objectId: forecast.materialCode,
          summary: `Прогноз исчерпания ${forecast.materialCode}: ${forecast.daysUntilExhaustion} дн.`,
          factors: [
            `История: ${forecast.fullWeeks} полных нед.`,
            `Средний недельный расход: ${formatNumber(forecast.averageWeeklyConsumption)} ${forecast.unit}.`,
            `Доступно: ${formatNumber(forecast.availableQuantity)} ${forecast.unit}.`,
          ],
          impact: "Материал может закончиться внутри выбранного горизонта.",
          recommendedActions: ["Проверить входящие поставки и сформировать план пополнения."],
          confidence: 0.85,
          ruleVersion: "stock-exhaustion-forecast-v1",
          requiresHumanReview: true,
        }));
        citations.push(...forecast.citations);
      }
      if (!comparableHistory) {
        missingData.push({
          code: movements.length === 0 ? "RISK_MOVEMENT_HISTORY_UNAVAILABLE" : "RISK_MOVEMENT_HISTORY_INSUFFICIENT",
          message: movements.length === 0
            ? "История движений в разрешённой области отсутствует"
            : "Для числового прогноза требуется не менее восьми полных недель сопоставимой истории",
        });
      }
    } else {
      missingData.push({ code: "RISK_STOCK_SCOPE_UNAVAILABLE", message: "Прогноз складского риска недоступен без складской области" });
    }

    const filtered = risks.filter((item) =>
      (!query.levels || query.levels.includes(item.level)) &&
      (!query.objectTypes || query.objectTypes.includes(item.objectType)) &&
      item.horizonDays <= horizonDays);
    const requestedScope = [
      `project:${query.selection.projectId}`,
      `horizon:${horizonDays}`,
      ...(query.levels ?? []).map((level) => `level:${level}`),
      ...(query.objectTypes ?? []).map((type) => `object:${type}`),
      ...warehouseIds.map((id) => `warehouse:${id}`),
    ];
    const complete = missingData.length === 0 && citations.length > 0;
    return {
      items: filtered,
      evidence: {
        availability: complete ? "COMPLETE" : filtered.length > 0 ? "PARTIAL" : "UNAVAILABLE",
        confidence: complete ? 0.85 : filtered.length > 0 ? 0.6 : 0,
        coverage: { requestedScope, checkedScope: complete ? requestedScope : [], complete },
        citations: distinctCitations(citations),
        missingData,
      },
    };
  }

  private async stockCoverage(
    context: AgentExecutionContext,
    query: KpiCalculationQuery,
    period: Readonly<{ from: string; to: string }>,
    previousPeriod: Readonly<{ from: string; to: string }>,
  ): Promise<KpiMetric | null> {
    const historyFrom = new Date(period.to);
    historyFrom.setUTCDate(historyFrom.getUTCDate() - 12 * 7);
    const [movements, stock] = await Promise.all([
      this.repository.listMaterialMovements(context.trusted.subjectId, {
        projectId: query.selection.projectId,
        warehouseIds: query.warehouseIds,
        from: historyFrom.toISOString(),
        to: period.to,
      }),
      this.repository.searchSapMaterials(context.trusted.subjectId, {
        warehouseIds: query.warehouseIds,
        limit: 500,
      }),
    ]);
    const current = coverageSnapshot(movements, stock.items, period.to);
    if (current.denominator === 0) return null;
    const previous = coverageSnapshot(movements, stock.items, previousPeriod.to);
    return metric(
      "STOCK_COVERAGE",
      period,
      current.numerator,
      current.denominator,
      percentage(current.numerator, current.denominator),
      previous.denominator ? percentage(previous.numerator, previous.denominator) : null,
      current.citations,
    );
  }
}

function processMetric(
  key: string,
  events: Awaited<ReturnType<MtrRepository["listAgentMetricEvents"]>>,
  period: Readonly<{ from: string; to: string }>,
  previousPeriod: Readonly<{ from: string; to: string }>,
): KpiMetric | null {
  const current = events.filter((event) => within(event.occurredAt, period));
  const previousEvents = events.filter((event) => within(event.occurredAt, previousPeriod));
  if (key === "ANALYSIS_COMPLETION_RATE") {
    const numerator = eventCount(current, "ANALYSIS_COMPLETED");
    const denominator = eventCount(current, "ANALYSIS_STARTED");
    if (denominator === 0) return null;
    const previousNumerator = eventCount(previousEvents, "ANALYSIS_COMPLETED");
    const previousDenominator = eventCount(previousEvents, "ANALYSIS_STARTED");
    return metric(key, period, numerator, denominator, percentage(numerator, denominator),
      previousDenominator ? percentage(previousNumerator, previousDenominator) : null,
      eventCitations(current.filter((event) => event.eventType === "ANALYSIS_STARTED" || event.eventType === "ANALYSIS_COMPLETED")));
  }
  if (key === "EXPERT_REVIEW_SHARE") {
    const numerator = eventCount(current, "EXPERT_TASK_ASSIGNED");
    const denominator = eventCount(current, "ANALYSIS_COMPLETED");
    if (denominator === 0) return null;
    const previousNumerator = eventCount(previousEvents, "EXPERT_TASK_ASSIGNED");
    const previousDenominator = eventCount(previousEvents, "ANALYSIS_COMPLETED");
    return metric(key, period, numerator, denominator, percentage(numerator, denominator),
      previousDenominator ? percentage(previousNumerator, previousDenominator) : null,
      eventCitations(current.filter((event) => event.eventType === "EXPERT_TASK_ASSIGNED" || event.eventType === "ANALYSIS_COMPLETED")));
  }
  if (key === "BUSINESS_CYCLE_TIME") {
    const completed = current.filter((event) => event.eventType === "ANALYSIS_COMPLETED");
    const durations = completed.map((event) => numberAttribute(event.attributes.cycleTimeMs)).filter(isNumber);
    if (durations.length === 0) return null;
    const previousDurations = previousEvents.filter((event) => event.eventType === "ANALYSIS_COMPLETED")
      .map((event) => numberAttribute(event.attributes.cycleTimeMs)).filter(isNumber);
    const numerator = durations.reduce((sum, value) => sum + value / 3_600_000, 0);
    const value = numerator / durations.length;
    const previousValue = previousDurations.length
      ? previousDurations.reduce((sum, duration) => sum + duration / 3_600_000, 0) / previousDurations.length
      : null;
    return metric(key, period, numerator, durations.length, value, previousValue, eventCitations(completed));
  }
  return null;
}

function metric(
  key: keyof typeof KPI_DEFINITIONS,
  period: Readonly<{ from: string; to: string }>,
  numerator: number,
  denominator: number,
  value: number,
  previousValue: number | null,
  sourceCitations: readonly KpiDrillDownItem[],
): KpiMetric {
  const definition = KPI_DEFINITIONS[key];
  const definitionCitation: KpiDrillDownItem = {
    sourceKind: "DEFINITION",
    sourceSystem: "METRIC_REGISTRY",
    entityId: key,
    sourceSnapshot: definition.version,
    observedAt: period.to,
  };
  const drillDown = distinctCitations([
    ...sourceCitations,
    definitionCitation,
  ]);
  return {
    metricKey: key,
    definitionVersion: definition.version,
    formula: definition.formula,
    period,
    numerator: round(numerator),
    denominator: round(denominator),
    value: round(value),
    unit: definition.unit,
    target: definition.target,
    deviation: round(value - definition.target),
    trend: previousValue === null ? "UNAVAILABLE" : trend(value, previousValue),
    availability: "COMPLETE",
    drillDown,
  };
}

function forecastMaterials(
  movements: Awaited<ReturnType<MtrRepository["listMaterialMovements"]>>,
  stock: Awaited<ReturnType<MtrRepository["searchSapMaterials"]>>["items"],
  horizonDays: number,
) {
  const byKey = new Map<string, typeof movements>();
  for (const movement of movements.filter((item) => item.movementType === "CONSUMPTION")) {
    const key = `${movement.materialCode}\u0000${movement.storageLocation}`;
    byKey.set(key, [...(byKey.get(key) ?? []), movement]);
  }
  return stock.flatMap((item) => {
    const history = byKey.get(`${item.materialCode}\u0000${item.storageLocation}`) ?? [];
    const weeks = new Set(history.map((movement) => isoWeek(movement.occurredAt))).size;
    const units = new Set(history.map((movement) => movement.unit));
    if (weeks < MIN_FORECAST_WEEKS || units.size !== 1 || !units.has(item.unit)) return [];
    const total = history.reduce((sum, movement) => sum + Number(movement.quantity), 0);
    const averageWeeklyConsumption = total / weeks;
    if (!(averageWeeklyConsumption > 0)) return [];
    const daysUntilExhaustion = Math.max(0, Math.round((item.availableQuantity / averageWeeklyConsumption) * 7));
    if (daysUntilExhaustion > horizonDays) return [];
    const score = Math.max(1, Math.min(100, Math.round((1 - daysUntilExhaustion / Math.max(1, horizonDays)) * 100)));
    return [{
      materialCode: item.materialCode,
      warehouseId: item.storageLocation,
      availableQuantity: item.availableQuantity,
      unit: item.unit,
      fullWeeks: weeks,
      averageWeeklyConsumption,
      daysUntilExhaustion,
      score,
      citations: history.slice(-12).map(movementCitation),
    }];
  });
}

function coverageSnapshot(
  movements: Awaited<ReturnType<MtrRepository["listMaterialMovements"]>>,
  stock: Awaited<ReturnType<MtrRepository["searchSapMaterials"]>>["items"],
  asOf: string,
) {
  const asOfTime = Date.parse(asOf);
  const eligibleMovements = movements.filter((movement) => Date.parse(movement.occurredAt) < asOfTime);
  const forecast = forecastMaterials(eligibleMovements, stock, 30);
  const forecastByKey = new Set(forecast.map((item) => `${item.materialCode}\u0000${item.warehouseId}`));
  const comparableKeys = new Set<string>();
  for (const item of stock) {
    const history = eligibleMovements.filter((movement) =>
      movement.materialCode === item.materialCode && movement.storageLocation === item.storageLocation);
    if (new Set(history.map((movement) => isoWeek(movement.occurredAt))).size >= MIN_FORECAST_WEEKS) {
      comparableKeys.add(`${item.materialCode}\u0000${item.storageLocation}`);
    }
  }
  return {
    numerator: comparableKeys.size - forecastByKey.size,
    denominator: comparableKeys.size,
    citations: eligibleMovements.slice(-60).map(movementCitation),
  };
}

function hasComparableHistory(
  movements: Awaited<ReturnType<MtrRepository["listMaterialMovements"]>>,
  stock: Awaited<ReturnType<MtrRepository["searchSapMaterials"]>>["items"],
): boolean {
  return stock.some((item) => {
    const history = movements.filter((movement) =>
      movement.materialCode === item.materialCode &&
      movement.storageLocation === item.storageLocation &&
      movement.unit === item.unit &&
      movement.movementType === "CONSUMPTION");
    return new Set(history.map((movement) => isoWeek(movement.occurredAt))).size >= MIN_FORECAST_WEEKS;
  });
}

function eventCount(
  events: Awaited<ReturnType<MtrRepository["listAgentMetricEvents"]>>,
  type: string,
): number {
  return events.filter((event) => event.eventType === type)
    .reduce((sum, event) => sum + (numberAttribute(event.attributes.count) ?? 1), 0);
}

function eventCitations(events: Awaited<ReturnType<MtrRepository["listAgentMetricEvents"]>>): KpiDrillDownItem[] {
  return events.slice(-50).map((event) => ({
    sourceKind: "PROCESS_EVENT",
    sourceSystem: "PROCESS_ENGINE",
    entityId: event.id,
    sourceSnapshot: event.sourceVersion,
    observedAt: iso(event.occurredAt),
  }));
}

function movementCitation(
  movement: Awaited<ReturnType<MtrRepository["listMaterialMovements"]>>[number],
): KpiDrillDownItem {
  return {
    sourceKind: "MATERIAL_MOVEMENT",
    sourceSystem: "SAP",
    entityId: movement.id,
    sourceSnapshot: movement.snapshotVersion,
    observedAt: iso(movement.occurredAt),
  };
}

function risk(input: AgentRisk): AgentRisk {
  return Object.freeze(input);
}

function requestedPeriod(
  selection: Readonly<{ from: string; to: string }> | undefined,
  now: Date,
  defaultDays: number,
) {
  if (selection) return { from: iso(selection.from), to: iso(selection.to) };
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - defaultDays);
  return { from: from.toISOString(), to: now.toISOString() };
}

function previous(period: Readonly<{ from: string; to: string }>) {
  const duration = Date.parse(period.to) - Date.parse(period.from);
  return { from: new Date(Date.parse(period.from) - duration).toISOString(), to: period.from };
}

function within(value: string, period: Readonly<{ from: string; to: string }>): boolean {
  const time = Date.parse(value);
  return time >= Date.parse(period.from) && time < Date.parse(period.to);
}

function assertScope(context: AgentExecutionContext, projectId: string): void {
  if (projectId !== context.trusted.activeProjectId) throw new Error("AGENT_ANALYTICS_SCOPE_DENIED");
}

function numberAttribute(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isNumber(value: number | null): value is number {
  return value !== null;
}

function percentage(numerator: number, denominator: number): number {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

function trend(value: number, previousValue: number): KpiMetric["trend"] {
  const delta = value - previousValue;
  if (Math.abs(delta) < 0.01) return "STABLE";
  return delta > 0 ? "UP" : "DOWN";
}

function levelForScore(score: number): AgentRisk["level"] {
  if (score >= 85) return "CRITICAL";
  if (score >= 65) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

function isoWeek(value: string): string {
  const date = new Date(value);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.valueOf() - yearStart.valueOf()) / DAY_MS) + 1) / 7);
  return `${date.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

function iso(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("AGENT_ANALYTICS_TIMESTAMP_INVALID");
  return new Date(parsed).toISOString();
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

function distinctCitations<T extends AgentCitation>(citations: readonly T[]): T[] {
  const result = new Map<string, T>();
  for (const citation of citations) {
    const key = `${citation.sourceKind}\u0000${citation.sourceSystem}\u0000${citation.entityId}\u0000${citation.sourceSnapshot}`;
    if (!result.has(key)) result.set(key, citation);
  }
  return [...result.values()].slice(0, 100);
}

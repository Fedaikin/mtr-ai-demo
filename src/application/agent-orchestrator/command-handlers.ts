import { assessNegativeEvidence } from "@/domain/agent/evidence";
import { AgentCommandExecutionError } from "@/domain/agent/errors";
import type { AgentCommandKey } from "@/domain/agent/commands";
import type { AgentExecutionContext } from "@/domain/agent/context";
import type {
  AgentCitation,
  AgentCommandRequestMap,
  AgentCommandResultMap,
  AgentEvidence,
  AgentOrchestratorPorts,
  AgentRisk,
  KpiMetric,
  ValidatedAgentSelection,
} from "@/ports/agent-orchestrator";

export interface AgentCommandHandler<K extends AgentCommandKey> {
  readonly key: K;
  execute(
    context: AgentExecutionContext,
    request: AgentCommandRequestMap[K],
    selection: ValidatedAgentSelection,
  ): Promise<AgentCommandResultMap[K]>;
}

export type AgentCommandHandlerMap = {
  readonly [K in AgentCommandKey]: AgentCommandHandler<K>;
};

export function createAgentCommandHandlers(
  ports: AgentOrchestratorPorts,
): AgentCommandHandlerMap {
  return {
    SUMMARY: {
      key: "SUMMARY",
      async execute(context, _request, selection) {
        const result = await ports.summary.read(context, { selection });
        const assessment = assessNegativeEvidence(result.facts.length, result.evidence);
        return {
          responseType: "SUMMARY",
          title: "Оперативная сводка",
          summary: result.facts.length
            ? `Сводка содержит подтверждённых фактов: ${result.facts.length}.`
            : emptySummary(assessment.conclusion),
          facts: result.facts,
          ...publicEvidence(result.evidence, assessment),
        };
      },
    },
    MY_TASKS: {
      key: "MY_TASKS",
      async execute(context, request, selection) {
        const result = await ports.tasks.listMine(context, {
          selection,
          assigneeSubjectId: context.trusted.subjectId,
          statuses: request.filters?.statuses,
          priorities: request.filters?.priorities,
        });
        const assessment = assessNegativeEvidence(result.items.length, result.evidence);
        return {
          responseType: "MY_TASKS",
          title: "Мои задачи",
          summary: result.items.length
            ? `Личных задач по выбранным условиям: ${result.items.length}.`
            : emptySummary(assessment.conclusion),
          items: result.items,
          ...publicEvidence(result.evidence, assessment),
        };
      },
    },
    RISKS: {
      key: "RISKS",
      async execute(context, request, selection) {
        const query = {
          selection,
          levels: request.filters?.levels,
          objectTypes: request.filters?.objectTypes,
          horizonDays: request.filters?.horizonDays,
        };
        const result = await ports.risks.evaluate(context, query);
        const items = filterRisks(result.items, query);
        const evidence = items.length === result.items.length
          ? result.evidence
          : markPartial(result.evidence, "RISK_FILTER_MISMATCH", "Источник вернул риски вне запрошенных условий");
        const assessment = assessNegativeEvidence(items.length, evidence);
        const requiresHumanReview =
          assessment.requiresHumanReview || items.some((item) => item.requiresHumanReview);
        return {
          responseType: "RISKS",
          title: "Риски",
          summary: riskSummary(items.length, assessment.conclusion),
          items,
          ...publicEvidence(evidence, { ...assessment, requiresHumanReview }),
        };
      },
    },
    STOCKS: {
      key: "STOCKS",
      async execute(context, request, selection) {
        const warehouseIds = validatedWarehouseIds(
          context,
          request.filters?.warehouseIds,
        );
        const result = await ports.stocks.search(context, {
          selection,
          materialCode: request.filters?.materialCode,
          query: request.filters?.query,
          warehouseIds,
        });
        const items = result.items.filter((item) => warehouseIds.includes(item.warehouseId));
        const evidence = items.length === result.items.length
          ? result.evidence
          : markPartial(result.evidence, "STOCK_SCOPE_MISMATCH", "Источник вернул данные склада вне разрешённой области");
        const assessment = assessNegativeEvidence(items.length, evidence, warehouseIds);
        return {
          responseType: "STOCKS",
          title: "Остатки",
          summary: stockSummary(items.length, assessment.conclusion),
          items,
          ...publicEvidence(evidence, assessment),
        };
      },
    },
    KPI: {
      key: "KPI",
      async execute(context, request, selection) {
        const result = await ports.metrics.calculate(context, {
          selection,
          metricKeys: request.filters?.metricKeys,
          warehouseIds: validatedWarehouseIds(context),
        });
        const citations = distinctCitations([
          ...result.evidence.citations,
          ...result.metrics.flatMap((metric) => metric.drillDown),
        ]);
        const evidence = { ...result.evidence, citations };
        const assessment = assessNegativeEvidence(result.metrics.length, evidence);
        const metricsNeedReview = result.metrics.some(metricNeedsReview);
        return {
          responseType: "KPI",
          title: "KPI и SLA",
          summary: result.metrics.length
            ? `Рассчитано показателей: ${result.metrics.length}.`
            : emptySummary(assessment.conclusion),
          metrics: result.metrics,
          ...publicEvidence(evidence, {
            ...assessment,
            requiresHumanReview: assessment.requiresHumanReview || metricsNeedReview,
          }),
        };
      },
    },
  };
}

function validatedWarehouseIds(
  context: AgentExecutionContext,
  requestedIds: readonly string[] | undefined = undefined,
): readonly string[] {
  const trustedWarehouseIds = new Set(context.trusted.accessClaims.warehouseIds ?? []);
  const contextWarehouseIds = new Set(context.warehouseScopeIds);
  const requested = requestedIds ?? context.warehouseScopeIds;
  const unique = [...new Set(requested)];
  if (
    unique.some(
      (warehouseId) =>
        !trustedWarehouseIds.has(warehouseId) || !contextWarehouseIds.has(warehouseId),
    )
  ) {
    throw new AgentCommandExecutionError("AGENT_WAREHOUSE_SCOPE_DENIED");
  }
  return unique;
}

function filterRisks(
  items: readonly AgentRisk[],
  query: {
    readonly levels?: readonly AgentRisk["level"][];
    readonly objectTypes?: readonly string[];
    readonly horizonDays?: number;
  },
): readonly AgentRisk[] {
  return items.filter(
    (item) =>
      (!query.levels || query.levels.includes(item.level)) &&
      (!query.objectTypes || query.objectTypes.includes(item.objectType)) &&
      (query.horizonDays === undefined || item.horizonDays <= query.horizonDays),
  );
}

function markPartial(evidence: AgentEvidence, code: string, message: string): AgentEvidence {
  return {
    ...evidence,
    availability: "PARTIAL",
    coverage: { ...evidence.coverage, complete: false },
    missingData: [...evidence.missingData, { code, message }],
  };
}

function publicEvidence(
  evidence: AgentEvidence,
  assessment: {
    readonly conclusion: "NOT_EMPTY" | "PROVEN_EMPTY" | "UNPROVEN_EMPTY";
    readonly confidence: number;
    readonly requiresHumanReview: boolean;
  },
) {
  return {
    citations: evidence.citations,
    missingData: evidence.missingData,
    confidence: assessment.confidence,
    requiresHumanReview: assessment.requiresHumanReview,
    negativeEvidence: assessment.conclusion,
    generatedAt: new Date().toISOString(),
  } as const;
}

function emptySummary(conclusion: "NOT_EMPTY" | "PROVEN_EMPTY" | "UNPROVEN_EMPTY"): string {
  return conclusion === "PROVEN_EMPTY"
    ? "В полностью проверенной области данные отсутствуют."
    : "Недостаточно данных для достоверного вывода по выбранной области.";
}

function riskSummary(
  count: number,
  conclusion: "NOT_EMPTY" | "PROVEN_EMPTY" | "UNPROVEN_EMPTY",
): string {
  if (count > 0) return `Активных рисков по выбранным условиям: ${count}.`;
  return conclusion === "PROVEN_EMPTY"
    ? "В полностью проверенной области активные риски не выявлены."
    : "Недостаточно данных, чтобы подтвердить отсутствие активных рисков.";
}

function stockSummary(
  count: number,
  conclusion: "NOT_EMPTY" | "PROVEN_EMPTY" | "UNPROVEN_EMPTY",
): string {
  if (count > 0) return `Найдено складских записей: ${count}.`;
  return conclusion === "PROVEN_EMPTY"
    ? "В полностью проверенной складской области позиции не найдены."
    : "Поиск не даёт доказанного результата: область или источник проверены не полностью.";
}

function metricNeedsReview(metric: KpiMetric): boolean {
  return metric.availability !== "COMPLETE" || metric.drillDown.length === 0;
}

function distinctCitations(citations: readonly AgentCitation[]): readonly AgentCitation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = [
      citation.sourceKind,
      citation.sourceSystem,
      citation.entityId,
      citation.sourceSnapshot,
    ].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

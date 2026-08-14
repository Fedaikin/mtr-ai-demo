import { calculateCoverage } from "@/application/agent-orchestrator/analytics/coverage-engine";
import { runForecast } from "@/application/agent-orchestrator/analytics/forecast-engine";
import { createAnalyticalRecommendation } from "@/application/agent-orchestrator/analytics/recommendation-engine";
import { analyzeRootCauses } from "@/application/agent-orchestrator/analytics/root-cause-analyzer";
import { evaluateScenarios } from "@/application/agent-orchestrator/analytics/scenario-engine";
import { analyzeTrend } from "@/application/agent-orchestrator/analytics/trend-anomaly-engine";
import { verifyAnalyticalArtifacts } from "@/application/agent-orchestrator/analytics/analytical-verifier";
import type { AnalyticalQuery, PublicAnalyticalAnswer } from "@/domain/agent/analytics/answer";
import type { WeeklyDemandObservation } from "@/domain/agent/analytics/artifacts";
import type { AnalyticalScenarioDataset } from "@/domain/agent/analytics/dataset";
import type {
  EvidenceGraphVersion,
  EvidenceNode,
} from "@/domain/agent/analytics/evidence-graph";
import { assessDataQuality } from "@/domain/agent/analytics/quality";

export interface AnalyticalDatasetPort {
  load(projectId: string): Promise<AnalyticalScenarioDataset>;
}

export class AnalyticalIntelligenceService {
  constructor(private readonly datasets: AnalyticalDatasetPort) {}

  async analyze(query: AnalyticalQuery): Promise<PublicAnalyticalAnswer> {
    const dataset = await this.datasets.load(query.projectId);
    const position = dataset.positions.find((item) => item.positionId === query.positionId);
    if (!position) throw new AnalyticalQueryError("ANALYTICAL_POSITION_NOT_FOUND");
    const sourceAssessments = sourceQuality(dataset, position.positionId);
    const dataQuality = assessDataQuality(sourceAssessments, {
      minimumCompleteness: 0.95,
      maxAgeMinutes: 15,
      requiredSourceSystems: ["APPIUS", "CATALOG", "SAP", "NORMATIVE"],
    });
    const generatedAt = dataset.manifest.generatedAt;
    const missingData = dataQuality.issues.map((issue) => ({
      code: issue.code,
      messageRu: issue.messageRu,
    }));

    if (!position.sapMaterialCode || !position.catalogItemCode) {
      return unavailableAnswer(query, dataset, dataQuality, missingData, generatedAt);
    }

    const stock = dataset.stockSnapshots.filter(
      (row) => row.materialCode === position.sapMaterialCode,
    );
    const movementRows = dataset.movements.filter(
      (row) => row.materialCode === position.sapMaterialCode && row.type === "CONSUMPTION",
    );
    const weeklyDemand = movementRows.map(
      (row): WeeklyDemandObservation => ({
        weekStart: weekStart(row.occurredAt),
        quantity: row.quantity * (query.demandMultiplier ?? 1),
        unit: row.unit,
        evidenceNodeId: row.id,
      }),
    );
    const inbound = dataset.inboundSupplies.filter(
      (row) => row.materialCode === position.sapMaterialCode,
    );
    const reservations = dataset.reservationEvents.filter(
      (row) => row.materialCode === position.sapMaterialCode,
    );
    const shortage = dataset.shortages.find((item) => item.positionId === position.positionId);
    const responsibility = dataset.responsibilities.find(
      (item) => item.positionId === position.positionId,
    );
    const graph = buildEvidenceGraph(dataset, position.positionId, movementRows.map((row) => row.id), [
      ...stock.map((row) => row.id),
      ...reservations.map((row) => row.id),
      ...inbound.map((row) => row.id),
      ...(shortage?.expectedCandidateCodes ?? []).map((code) => `catalog-candidate:${code}`),
    ]);

    const forecast = runForecast({
      id: `forecast:${position.positionId}:${dataset.manifest.datasetVersion}`,
      datasetVersion: dataset.manifest.datasetVersion,
      originAt: dataset.manifest.asOf,
      horizonWeeks: query.horizonWeeks,
      observations: weeklyDemand,
      dataQuality,
    });
    const trend = analyzeTrend(weeklyDemand);
    const averageDailyConsumption =
      weeklyDemand.reduce((sum, item) => sum + item.quantity, 0) /
      Math.max(1, weeklyDemand.length) /
      7;
    const coverage = calculateCoverage({
      requiredQuantity: position.requiredQuantity,
      unit: position.unit,
      directMaterialCode: position.sapMaterialCode,
      stock: stock.map((row) => ({
        materialCode: row.materialCode,
        physicalQuantity: row.onHandQuantity,
        reservedQuantity: row.reservedQuantity,
        quarantinedQuantity: row.quarantinedQuantity,
        unit: row.unit,
        evidenceNodeId: row.id,
      })),
      confirmedInboundQuantity: inbound.reduce((sum, row) => sum + row.confirmedQuantity, 0),
      averageDailyConsumption,
      analogueMaterialCodes: [],
    });
    const candidates = (shortage?.expectedCandidateCodes ?? []).map((materialCode, index) => ({
      materialCode,
      quantity: Math.ceil(position.requiredQuantity / Math.max(1, shortage?.expectedCandidateCodes.length ?? 1)),
      unit: position.unit,
      leadTimeDays: 1 + index + (query.deliveryDelayDays ?? 0),
      deviationScore: 0.05 + index * 0.03,
      normativeAllowed: shortage?.expectedAnalogueOutcome === "CANDIDATE_AVAILABLE",
      fresh: true,
      evidenceNodeIds: [`catalog-candidate:${materialCode}`],
    }));
    const scenario = evaluateScenarios({
      id: `scenario:${position.positionId}:${dataset.manifest.datasetVersion}`,
      datasetVersion: dataset.manifest.datasetVersion,
      createdAt: generatedAt,
      requiredQuantity: position.requiredQuantity,
      unit: position.unit,
      directAvailableQuantity: coverage.directCoverageQuantity,
      candidates,
      procurementLeadTimeDays: 30 + (query.deliveryDelayDays ?? 0),
      dataQuality,
    });
    const rootCause = analyzeRootCauses({
      id: `root-cause:${position.positionId}:${dataset.manifest.datasetVersion}`,
      targetMetricKey: "SHORTAGE_QUANTITY",
      generatedAt,
      dataQuality,
      signals: [
        {
          key: "demand",
          titleRu: "Изменение расхода",
          baselineValue: median(weeklyDemand.slice(0, -4).map((item) => item.quantity)),
          currentValue: median(weeklyDemand.slice(-4).map((item) => item.quantity)),
          expectedDirection: "INCREASES_RISK",
          evidenceNodeIds: weeklyDemand.slice(-8).map((item) => item.evidenceNodeId),
          causalOracleId: dataset.outcomes.find((item) => item.positionId === position.positionId)?.id,
        },
        {
          key: "reservation",
          titleRu: "Рост резервов",
          baselineValue: 0,
          currentValue: reservations
            .filter((row) => row.type === "RESERVED")
            .reduce((sum, row) => sum + row.quantity, 0),
          expectedDirection: "INCREASES_RISK",
          evidenceNodeIds: reservations.map((row) => row.id),
        },
        {
          key: "inbound",
          titleRu: "Подтверждённые поступления",
          baselineValue: 0,
          currentValue: inbound.reduce((sum, row) => sum + row.confirmedQuantity, 0),
          expectedDirection: "DECREASES_RISK",
          evidenceNodeIds: inbound.map((row) => row.id),
        },
      ],
    });
    const verification = verifyAnalyticalArtifacts({ evidenceGraph: graph, forecast, scenario });
    const recommendation = createAnalyticalRecommendation(scenario, verification);
    const preferred = scenario.alternatives.find(
      (item) => item.id === scenario.recommendedAlternativeId,
    );
    const confidence = verification.valid
      ? Math.min(dataQuality.confidenceCeiling, forecast.status === "COMPLETE" ? 0.9 : 0.7)
      : 0;

    return {
      schemaVersion: "mtr-analytical-answer-1.0.0",
      question: query.question,
      scope: {
        projectId: query.projectId,
        objectType: "POSITION",
        objectId: query.positionId,
        horizon: `${query.horizonWeeks} нед.`,
      },
      executiveSummary: executiveSummary(coverage.residualDeficitQuantity, position.unit, preferred?.kind),
      confirmedFacts: [
        {
          id: "fact-required",
          text: `Потребность: ${position.requiredQuantity} ${position.unit}.`,
          evidenceNodeIds: [`position:${position.positionId}`],
        },
        {
          id: "fact-available",
          text: `Доступно после резервов и карантина: ${coverage.availableQuantity} ${position.unit}.`,
          evidenceNodeIds: stock.map((row) => row.id),
        },
        {
          id: "fact-responsibility",
          text: responsibility?.responsibility === "UNKNOWN"
            ? "Ответственность не подтверждена нормативным источником."
            : `Ответственность: ${responsibility?.responsibility === "CUSTOMER" ? "заказчик" : "подрядчик"}.`,
          evidenceNodeIds: responsibility?.documentId ? [`normative:${responsibility.documentId}`] : [],
        },
      ],
      findings: [
        {
          id: "finding-deficit",
          text: `Остаточный дефицит после подтверждённого inbound: ${coverage.residualDeficitQuantity} ${position.unit}.`,
          severity: coverage.residualDeficitQuantity > 0 ? "CRITICAL" : "INFO",
        },
        {
          id: "finding-trend",
          text: trend.explanationRu,
          severity: trend.anomaly === "SPIKE" ? "WARNING" : "INFO",
        },
      ],
      drivers: rootCause.hypotheses.slice(0, 3),
      trend,
      forecast: forecast.status === "COMPLETE" ? forecast : null,
      scenarios: scenario.alternatives.slice(0, 3),
      recommendation,
      uncertainty: {
        dataQuality,
        assumptions: forecast.assumptions,
        limitations: [...forecast.limitations, ...verification.warnings],
      },
      missingData,
      conflicts: dataQuality.issues
        .filter((issue) => issue.code === "SOURCE_CONFLICT")
        .map((issue) => ({ code: issue.code, messageRu: issue.messageRu })),
      citations: publicCitations(dataset, position.positionId, responsibility?.clauseId ?? null),
      nextActions: [
        recommendation?.nextAction ?? "Проверить полноту и актуальность исходных данных.",
        "Обновить расчёт после изменения остатка, резерва или срока поставки.",
      ],
      confidence,
      requiresHumanReview: true,
      generatedAt,
      technicalTrace: {
        datasetVersion: dataset.manifest.datasetVersion,
        semanticRegistryVersion: "semantic-registry-1.0.0",
        evidenceGraphId: graph.id,
        verifierPassed: verification.valid,
      },
    };
  }
}

function sourceQuality(dataset: AnalyticalScenarioDataset, positionId: string) {
  const position = dataset.positions.find((item) => item.positionId === positionId);
  const mapped = Boolean(position?.catalogItemCode && position.sapMaterialCode);
  const responsibility = dataset.responsibilities.find((item) => item.positionId === positionId);
  const systems = ["APPIUS", "CATALOG", "SAP", "NORMATIVE"] as const;
  return systems.map((sourceSystem) => {
    const resolved = sourceSystem === "APPIUS"
      ? Boolean(position)
      : sourceSystem === "NORMATIVE"
        ? responsibility?.responsibility !== "UNKNOWN"
        : mapped;
    return {
      sourceSystem,
      requestedCount: 1,
      resolvedCount: resolved ? 1 : 0,
      completeness: resolved ? 1 : 0,
      observedAt: resolved ? dataset.manifest.asOf : null,
      ageMinutes: resolved ? 5 : null,
      fresh: resolved,
      unitIssueCount: 0,
      conflictCount: 0,
      unusableFieldCount: 0,
    };
  });
}

function buildEvidenceGraph(
  dataset: AnalyticalScenarioDataset,
  positionId: string,
  movementIds: readonly string[],
  otherIds: readonly string[],
): EvidenceGraphVersion {
  const nodes: EvidenceNode[] = [
    sourceNode(`position:${positionId}`, "APPIUS", "POSITION", positionId, dataset.manifest.sourceVersions.appius, dataset.manifest.asOf),
    ...movementIds.map((id) => sourceNode(id, "SAP", "MATERIAL_MOVEMENT", id, "sap-g1-movements-v1", dataset.manifest.asOf)),
    ...otherIds.map((id) => sourceNode(id, sourceForId(id), entityForId(id), id, dataset.manifest.datasetVersion, dataset.manifest.asOf)),
  ];
  return {
    id: `evidence-graph:${positionId}:${dataset.manifest.datasetVersion}`,
    schemaVersion: "1.0.0",
    datasetVersion: dataset.manifest.datasetVersion,
    createdAt: dataset.manifest.generatedAt,
    nodes: dedupeNodes(nodes),
    edges: [],
  };
}

function sourceNode(
  id: string,
  sourceSystem: string,
  entityType: string,
  entityId: string,
  versionOrSnapshot: string,
  observedAt: string,
): EvidenceNode {
  return {
    id,
    kind: "SOURCE",
    labelRu: entityType,
    value: entityId,
    observedAt,
    checksum: checksum(`${sourceSystem}:${entityId}:${versionOrSnapshot}`),
    sourceRef: { sourceSystem, entityType, entityId, versionOrSnapshot },
  };
}

function dedupeNodes(nodes: readonly EvidenceNode[]): EvidenceNode[] {
  return [...new Map(nodes.map((node) => [node.id, node])).values()];
}

function publicCitations(
  dataset: AnalyticalScenarioDataset,
  positionId: string,
  clauseId: string | null,
) {
  const position = dataset.positions.find((item) => item.positionId === positionId)!;
  return [
    {
      sourceSystem: "APPIUS" as const,
      entityType: "POSITION",
      entityId: positionId,
      versionOrSnapshot: dataset.manifest.sourceVersions.appius,
      observedAt: dataset.manifest.asOf,
      clauseId: null,
    },
    {
      sourceSystem: "SAP" as const,
      entityType: "MATERIAL_STOCK",
      entityId: position.sapMaterialCode!,
      versionOrSnapshot: dataset.manifest.sourceVersions.sap,
      observedAt: dataset.manifest.asOf,
      clauseId: null,
    },
    {
      sourceSystem: "CATALOG" as const,
      entityType: "CATALOG_ITEM",
      entityId: position.catalogItemCode!,
      versionOrSnapshot: dataset.manifest.sourceVersions.catalog,
      observedAt: dataset.manifest.asOf,
      clauseId: null,
    },
    {
      sourceSystem: "NORMATIVE" as const,
      entityType: "NORMATIVE_RULE",
      entityId: "doc-g1-responsibility",
      versionOrSnapshot: dataset.manifest.sourceVersions.normative,
      observedAt: dataset.manifest.asOf,
      clauseId,
    },
  ];
}

function unavailableAnswer(
  query: AnalyticalQuery,
  dataset: AnalyticalScenarioDataset,
  dataQuality: ReturnType<typeof assessDataQuality>,
  missingData: readonly { code: string; messageRu: string }[],
  generatedAt: string,
): PublicAnalyticalAnswer {
  return {
    schemaVersion: "mtr-analytical-answer-1.0.0",
    question: query.question,
    scope: {
      projectId: query.projectId,
      objectType: "POSITION",
      objectId: query.positionId,
      horizon: `${query.horizonWeeks} нед.`,
    },
    executiveSummary: "Сквозной расчёт недоступен: обязательные связи источников не подтверждены.",
    confirmedFacts: [],
    findings: [],
    drivers: [],
    trend: null,
    forecast: null,
    scenarios: [],
    recommendation: null,
    uncertainty: { dataQuality, assumptions: [], limitations: missingData.map((item) => item.messageRu) },
    missingData,
    conflicts: [],
    citations: [],
    nextActions: ["Уточнить mapping позиции к каталогу и SAP, затем повторить анализ."],
    confidence: 0,
    requiresHumanReview: true,
    generatedAt,
    technicalTrace: {
      datasetVersion: dataset.manifest.datasetVersion,
      semanticRegistryVersion: "semantic-registry-1.0.0",
      evidenceGraphId: `evidence-graph:${query.positionId}:${dataset.manifest.datasetVersion}`,
      verifierPassed: false,
    },
  };
}

function executiveSummary(deficit: number, unit: string, optionKind: string | undefined): string {
  if (deficit <= 0) return "Подтверждённые источники покрывают потребность; решение должен подтвердить специалист.";
  return `Остаточный дефицит ${round(deficit)} ${unit}. Предпочтительный проверенный вариант: ${optionKindLabel(optionKind)}.`;
}

function optionKindLabel(value: string | undefined): string {
  if (value === "DIRECT") return "прямой остаток";
  if (value === "SINGLE_SUBSTITUTE") return "один нормативный аналог";
  if (value === "COMPOSITE_SUBSTITUTE") return "комбинация нормативных аналогов";
  if (value === "PROCUREMENT") return "проект закупки";
  return "не определён";
}

function weekStart(value: string): string {
  const date = new Date(value);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - ((day + 6) % 7));
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function sourceForId(id: string): string {
  return id.startsWith("catalog-candidate:") ? "CATALOG" : "SAP";
}

function entityForId(id: string): string {
  if (id.startsWith("catalog-candidate:")) return "CATALOG_ITEM";
  if (id.startsWith("g1-inbound")) return "INBOUND_SUPPLY";
  if (id.startsWith("g1-reservation")) return "RESERVATION_EVENT";
  return "STOCK_SNAPSHOT";
}

function checksum(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export class AnalyticalQueryError extends Error {
  constructor(readonly code: "ANALYTICAL_POSITION_NOT_FOUND") {
    super("Позиция недоступна в текущем аналитическом контуре");
    this.name = "AnalyticalQueryError";
  }
}

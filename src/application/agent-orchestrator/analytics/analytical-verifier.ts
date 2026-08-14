import type {
  AnalyticalScenarioRun,
  ForecastRun,
  VerificationResult,
} from "@/domain/agent/analytics/artifacts";
import type { EvidenceGraphVersion } from "@/domain/agent/analytics/evidence-graph";
import { validateEvidenceGraph } from "@/domain/agent/analytics/evidence-graph";

export interface AnalyticalVerificationRequest {
  readonly evidenceGraph: EvidenceGraphVersion;
  readonly forecast?: ForecastRun;
  readonly scenario?: AnalyticalScenarioRun;
}

export function verifyAnalyticalArtifacts(
  request: AnalyticalVerificationRequest,
): VerificationResult {
  const graph = validateEvidenceGraph(request.evidenceGraph);
  const errors = [...graph.errors];
  const warnings: string[] = [];
  const nodeIds = new Set(request.evidenceGraph.nodes.map((node) => node.id));
  let confidenceCeiling = 1;

  if (request.forecast) {
    confidenceCeiling = Math.min(confidenceCeiling, request.forecast.dataQuality.confidenceCeiling);
    if (request.forecast.status === "COMPLETE") {
      if (!request.forecast.selectedModel || request.forecast.selectedModel.metrics.originCount < 2) {
        errors.push("Числовой прогноз не имеет достаточного rolling-origin backtest.");
      }
      if (request.forecast.points.some((point) => point.lower > point.point || point.point > point.upper)) {
        errors.push("Интервал прогноза не содержит point estimate.");
      }
      for (const evidenceNodeId of request.forecast.inputEvidenceNodeIds) {
        if (!nodeIds.has(evidenceNodeId)) errors.push(`Прогноз ссылается на отсутствующий evidence ${evidenceNodeId}.`);
      }
    } else {
      warnings.push("Числовой прогноз недоступен; требуется явное abstention-сообщение.");
    }
  }

  if (request.scenario) {
    confidenceCeiling = Math.min(confidenceCeiling, request.scenario.dataQuality.confidenceCeiling);
    const recommended = request.scenario.alternatives.find(
      (item) => item.id === request.scenario?.recommendedAlternativeId,
    );
    if (request.scenario.recommendedAlternativeId && !recommended?.feasible) {
      errors.push("Рекомендованный сценарий не прошёл hard constraints.");
    }
    if (request.scenario.requiresHumanDecision !== true) {
      errors.push("Аналитический сценарий не может подменять решение человека.");
    }
    for (const alternative of request.scenario.alternatives) {
      const allocated = alternative.allocations.reduce((sum, item) => sum + item.quantity, 0);
      if (Math.abs(allocated - alternative.coveredQuantity) > 0.0001) {
        errors.push(`Сценарий ${alternative.id} содержит арифметическое расхождение.`);
      }
      for (const evidenceNodeId of alternative.evidenceNodeIds) {
        if (!nodeIds.has(evidenceNodeId)) errors.push(`Сценарий ссылается на отсутствующий evidence ${evidenceNodeId}.`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    confidenceCeiling: errors.length > 0 ? 0 : confidenceCeiling,
    requiresHumanReview: true,
    errors,
    warnings,
  };
}

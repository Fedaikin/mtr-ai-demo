import "server-only";

import type { MtrRepository } from "@/adapters/persistence/repository";
import { createAnalysisReviewDecisionReadPort } from "@/adapters/persistence/agent-task-port";
import { AgentTaskService } from "@/application/agent-orchestrator/task-service";
import { RuntimeAgentAnalyticsService } from "@/application/agent-orchestrator/runtime-analytics-service";
import { AgentCommandExecutionError } from "@/domain/agent/errors";
import type { AgentExecutionContext } from "@/domain/agent/context";
import type {
  AgentCitation,
  AgentEvidence,
  AgentEvidenceSourceSystem,
} from "@/domain/agent/evidence";
import type { IntegrationState, ScenarioRun } from "@/domain/models";
import type {
  AgentOrchestratorPorts,
  ValidatedAgentSelection,
} from "@/ports/agent-orchestrator";

const MAX_REPOSITORY_PAGE = 200;
const MAX_STOCK_PAGE = 500;

/**
 * Repository-backed command adapters. Missing task/risk/metric stores are
 * surfaced as unavailable instead of being replaced by deterministic fixtures.
 */
export function createAgentOrchestratorPersistencePorts(
  repository: MtrRepository,
): AgentOrchestratorPorts {
  const taskService = new AgentTaskService(createAnalysisReviewDecisionReadPort(repository));
  const analyticsService = new RuntimeAgentAnalyticsService(repository);
  return {
    summary: {
      async read(context, query) {
        assertValidatedSelection(context, query.selection);
        const subjectId = context.trusted.subjectId;
        const selection = query.selection;
        const specificationPromise = selection.specificationId
          ? repository.getSpecification(subjectId, selection.specificationId)
          : Promise.resolve(null);
        const latestVersionPromise = selection.specificationId
          ? repository.getLatestVersion(subjectId, selection.specificationId)
          : Promise.resolve(null);
        const specificationsPromise = selection.specificationId
          ? Promise.resolve([])
          : repository.listSpecifications(subjectId);
        const positionsPromise = repository.listPositions(subjectId, {
          ...(selection.specificationId === undefined
            ? {}
            : { specificationId: selection.specificationId }),
          currentOnly: true,
          limit: MAX_REPOSITORY_PAGE,
        });
        const runsPromise = repository.listRuns(subjectId, {
          projectId: selection.projectId,
          includeSteps: false,
          limit: MAX_REPOSITORY_PAGE,
        });
        const integrationsPromise = repository.listIntegrationStates(subjectId);

        const [specification, latestVersion, specifications, allPositions, allRuns, integrations] =
          await Promise.all([
            specificationPromise,
            latestVersionPromise,
            specificationsPromise,
            positionsPromise,
            runsPromise,
            integrationsPromise,
          ]);

        const positions = selection.positionId
          ? allPositions.filter((position) => position.id === selection.positionId)
          : allPositions;
        const runs = filterRuns(allRuns, selection);
        const missingData: AgentEvidence["missingData"][number][] = [];
        if (selection.specificationId && !specification) {
          missingData.push({
            code: "SUMMARY_SPECIFICATION_NOT_FOUND",
            message: "Выбранная спецификация недоступна в текущем контексте",
          });
        }
        if (selection.positionId && positions.length === 0) {
          missingData.push({
            code: "SUMMARY_POSITION_NOT_FOUND",
            message: "Выбранная позиция недоступна в актуальной версии спецификации",
          });
        }
        if (selection.period) {
          missingData.push({
            code: "SUMMARY_PERIOD_FILTER_POST_RETRIEVAL",
            message: "Repository не поддерживает фильтр запусков по периоду до чтения",
          });
        }
        const unavailableSystems = integrations.filter(
          (state) => state.state !== "AVAILABLE" && state.state !== "SLOW",
        );
        if (unavailableSystems.length > 0) {
          missingData.push({
            code: "SUMMARY_SOURCE_STATE_PARTIAL",
            message: `Источники с ограниченной доступностью: ${unavailableSystems
              .map((state) => state.system)
              .join(", ")}`,
          });
        }

        const activeRuns = runs.filter((run) => !isTerminalRun(run));
        const failedRuns = runs.filter((run) => run.status === "FAILED");
        const facts = [
          selection.specificationId
            ? `Выбрана спецификация: ${specification?.name ?? "недоступна"}.`
            : `Доступных спецификаций: ${specifications.length}.`,
          `Позиций в выбранной области: ${positions.length}.`,
          `Активных запусков: ${activeRuns.length}; завершившихся ошибкой: ${failedRuns.length}.`,
          `Состояний источников получено: ${integrations.length}.`,
        ];
        const citations = distinctCitations([
          ...(latestVersion
            ? [
                {
                  sourceKind: "SPECIFICATION_VERSION" as const,
                  sourceSystem: "APPIUS" as const,
                  entityId: latestVersion.id,
                  sourceSnapshot: latestVersion.id,
                  observedAt: latestVersion.effectiveAt,
                },
              ]
            : []),
          ...runs.slice(0, 20).map(runCitation),
          ...integrations.flatMap(integrationCitation),
        ]);
        const requestedScope = selectionScope(selection);
        const complete = missingData.length === 0 && citations.length > 0;

        return {
          facts,
          evidence: {
            availability: complete ? "COMPLETE" : "PARTIAL",
            confidence: complete ? 0.9 : 0.6,
            coverage: {
              requestedScope,
              checkedScope: complete ? requestedScope : checkedSelectionScope(selection, {
                hasSpecification: !selection.specificationId || Boolean(specification),
                hasPosition: !selection.positionId || positions.length > 0,
                hasPeriod: !selection.period,
              }),
              complete,
            },
            citations,
            missingData,
          },
        };
      },
    },
    tasks: {
      async listMine(context, query) {
        assertValidatedSelection(context, query.selection);
        if (query.assigneeSubjectId !== context.trusted.subjectId) {
          throw new AgentCommandExecutionError("AGENT_SELECTION_STALE");
        }
        const snapshot = await taskService.listPersonal(context, {
          projectId: query.selection.projectId,
          statuses: query.statuses,
          priorities: query.priorities,
        });
        const requestedScope = selectionScope(query.selection);
        return {
          items: snapshot.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            priority: task.priority,
            dueAt: task.dueAt,
          })),
          evidence: {
            availability: snapshot.availability,
            confidence: snapshot.complete ? 1 : 0,
            coverage: {
              requestedScope,
              checkedScope: snapshot.complete ? requestedScope : [],
              complete: snapshot.complete,
            },
            citations: snapshot.tasks.length > 0
              ? snapshot.tasks.map((task) => ({
                  sourceKind: "TASK_RECORD" as const,
                  sourceSystem: "TASK_STORE" as const,
                  entityId: task.id,
                  sourceSnapshot: task.updatedAt,
                  observedAt: snapshot.snapshotAt,
                }))
              : [{
                  sourceKind: "TASK_RECORD" as const,
                  sourceSystem: "TASK_STORE" as const,
                  entityId: `task-query:${context.trusted.subjectId}:${query.selection.projectId}`,
                  sourceSnapshot: snapshot.snapshotAt,
                  observedAt: snapshot.snapshotAt,
                }],
            missingData: snapshot.missingData,
          },
        };
      },
    },
    risks: {
      async evaluate(context, query) {
        assertValidatedSelection(context, query.selection);
        return analyticsService.evaluateRisks(context, query);
      },
    },
    stocks: {
      async search(context, query) {
        assertValidatedSelection(context, query.selection);
        if (query.warehouseIds.length === 0) {
          return {
            items: [],
            evidence: unavailableEvidence(
              "WAREHOUSE_SCOPE_EMPTY",
              "Нет доступных складов для поиска",
              ["warehouse-scope:empty"],
            ),
          };
        }

        const subjectId = context.trusted.subjectId;
        const sapState = await repository.getIntegrationState(subjectId, "SAP");
        if (sapState && !["AVAILABLE", "SLOW", "STALE"].includes(sapState.state)) {
          return {
            items: [],
            evidence: {
              ...unavailableEvidence(
                "SAP_STOCK_UNAVAILABLE",
                sapState.safeMessage ?? "Источник складских данных недоступен",
                query.warehouseIds,
              ),
              citations: integrationCitation(sapState),
            },
          };
        }

        const result = await repository.searchSapMaterials(subjectId, {
          ...(query.materialCode === undefined ? {} : { materialCode: query.materialCode }),
          ...(query.query === undefined ? {} : { text: query.query }),
          warehouseIds: query.warehouseIds,
          limit: MAX_STOCK_PAGE,
        });
        const allowedWarehouses = new Set(query.warehouseIds);
        const scopedMaterials = result.items.filter((item) =>
          allowedWarehouses.has(item.storageLocation),
        );
        const completePage = result.items.length >= result.total;
        const missingData: AgentEvidence["missingData"][number][] = [
          {
            code: "STOCK_RESERVATION_DATA_UNAVAILABLE",
            message: "Repository не предоставляет резерв и карантин отдельными измерениями",
          },
        ];
        if (!completePage) {
          missingData.push({
            code: "STOCK_PAGE_PARTIAL",
            message: "Результат ограничен максимальным размером страницы repository",
          });
        }
        const items = scopedMaterials.map((material) => ({
          materialCode: material.materialCode,
          warehouseId: material.storageLocation,
          availableQuantity: material.availableQuantity,
          reservedQuantity: null,
          quarantinedQuantity: null,
          unit: material.unit,
          snapshotAt: material.snapshotAt,
        }));
        const citations: AgentCitation[] = scopedMaterials.map((material) => ({
          sourceKind: "STOCK_SNAPSHOT",
          sourceSystem: "SAP",
          entityId: `${material.materialCode}:${material.plant}:${material.storageLocation}`,
          sourceSnapshot: material.snapshotAt,
          observedAt: material.snapshotAt,
        }));

        return {
          items,
          evidence: {
            availability: "PARTIAL",
            confidence: citations.length > 0 ? 0.75 : 0,
            coverage: {
              requestedScope: query.warehouseIds,
              checkedScope: completePage ? query.warehouseIds : [...new Set(items.map((item) => item.warehouseId))],
              complete: false,
            },
            citations: distinctCitations([
              ...citations,
              ...(sapState ? integrationCitation(sapState) : []),
            ]),
            missingData,
          },
        };
      },
    },
    metrics: {
      async calculate(context, query) {
        assertValidatedSelection(context, query.selection);
        return analyticsService.calculateKpi(context, query);
      },
    },
  };
}

function assertValidatedSelection(
  context: AgentExecutionContext,
  selection: ValidatedAgentSelection,
): void {
  if (
    selection.projectId !== context.trusted.activeProjectId ||
    selection.validatedSubjectId !== context.trusted.subjectId ||
    selection.validatedAgainstAuthorizationVersion !== context.trusted.authorizationVersion ||
    selection.validationRequestId !== context.trusted.requestId
  ) {
    throw new AgentCommandExecutionError("AGENT_SELECTION_STALE");
  }
}

function unavailableEvidence(
  code: string,
  message: string,
  requestedScope: readonly string[],
): AgentEvidence {
  return {
    availability: "UNAVAILABLE",
    confidence: 0,
    coverage: { requestedScope, checkedScope: [], complete: false },
    citations: [],
    missingData: [{ code, message }],
  };
}

function filterRuns(
  runs: readonly ScenarioRun[],
  selection: ValidatedAgentSelection,
): readonly ScenarioRun[] {
  return runs.filter((run) => {
    if (selection.specificationId && run.specificationId !== selection.specificationId) return false;
    if (selection.runId && run.id !== selection.runId) return false;
    if (selection.period) {
      const timestamp = Date.parse(run.updatedAt);
      if (timestamp < Date.parse(selection.period.from) || timestamp > Date.parse(selection.period.to)) {
        return false;
      }
    }
    return true;
  });
}

function isTerminalRun(run: ScenarioRun): boolean {
  return run.status === "COMPLETED" || run.status === "FAILED" || run.status === "CANCELLED";
}

function runCitation(run: ScenarioRun): AgentCitation {
  return {
    sourceKind: "PROCESS_EVENT",
    sourceSystem: "PROCESS_ENGINE",
    entityId: run.id,
    sourceSnapshot: `${run.id}:v${run.version}`,
    observedAt: run.updatedAt,
  };
}

function integrationCitation(state: IntegrationState): AgentCitation[] {
  const observedAt = state.snapshotAt ?? state.lastSynchronizedAt;
  if (!observedAt || !Number.isFinite(Date.parse(observedAt))) return [];
  return [
    {
      sourceKind: "TECHNICAL_SAMPLE",
      sourceSystem: integrationSourceSystem(state.system),
      entityId: `integration-state:${state.system}`,
      sourceSnapshot: `${state.system}:${observedAt}`,
      observedAt,
    },
  ];
}

function integrationSourceSystem(system: IntegrationState["system"]): AgentEvidenceSourceSystem {
  return system;
}

function selectionScope(selection: ValidatedAgentSelection): string[] {
  return [
    `project:${selection.projectId}`,
    ...(selection.specificationId ? [`specification:${selection.specificationId}`] : []),
    ...(selection.positionId ? [`position:${selection.positionId}`] : []),
    ...(selection.runId ? [`run:${selection.runId}`] : []),
    ...(selection.period ? [`period:${selection.period.from}/${selection.period.to}`] : []),
  ];
}

function checkedSelectionScope(
  selection: ValidatedAgentSelection,
  checks: { readonly hasSpecification: boolean; readonly hasPosition: boolean; readonly hasPeriod: boolean },
): string[] {
  return [
    `project:${selection.projectId}`,
    ...(selection.specificationId && checks.hasSpecification
      ? [`specification:${selection.specificationId}`]
      : []),
    ...(selection.positionId && checks.hasPosition ? [`position:${selection.positionId}`] : []),
    ...(selection.runId ? [`run:${selection.runId}`] : []),
    ...(selection.period && checks.hasPeriod
      ? [`period:${selection.period.from}/${selection.period.to}`]
      : []),
  ];
}

function distinctCitations(citations: readonly AgentCitation[]): AgentCitation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = `${citation.sourceKind}\u0000${citation.sourceSystem}\u0000${citation.entityId}\u0000${citation.sourceSnapshot}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

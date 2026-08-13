import "server-only";

import type { MtrRepository } from "@/adapters/persistence/repository";
import type {
  AgentActionExecutor,
} from "@/application/agent-orchestrator/action-service";
import type { TrustedRequestContext } from "@/application/authorization-service";
import { loadAuthorizedScenarioCase } from "@/application/agent-orchestrator/case-access";
import { ScenarioService } from "@/application/scenario-service";
import type {
  ActionExecutionResult,
  AgentActionProposal,
} from "@/domain/agent/actions";
import type { ResourceDescriptor } from "@/application/authorization-service";

export interface ActionExecutionScheduler {
  scheduleScenarioRun(subjectId: string, runId: string): void;
}

export class PlatformAgentActionExecutor implements AgentActionExecutor {
  private readonly scenarios: ScenarioService;

  constructor(
    private readonly repository: MtrRepository,
    private readonly scheduler: ActionExecutionScheduler,
  ) {
    this.scenarios = new ScenarioService(repository);
  }

  async resolveCurrent(
    proposal: AgentActionProposal,
    context: TrustedRequestContext,
  ): Promise<ResourceDescriptor | null> {
    if (proposal.projectId !== context.activeProjectId) return null;
    if (proposal.actionType === "RUN_SCENARIO") {
      const scenario = await this.repository.getScenario(context.subjectId, proposal.resource.resourceId);
      return scenario
        ? {
            resourceType: "SCENARIO_TEMPLATE",
            resourceId: scenario.id,
            projectId: proposal.projectId,
            ownerUserId: context.subjectId,
            status: scenario.enabled ? "AVAILABLE" : "DISABLED",
          }
        : null;
    }
    const runId = runIdFrom(proposal);
    if (!runId) return null;
    const run = await loadAuthorizedScenarioCase(this.repository, context, runId);
    return run
      ? {
          resourceType: "SCENARIO_RUN",
          resourceId: run.id,
          projectId: proposal.projectId,
          ownerUserId: run.userId,
          status: run.status,
        }
      : null;
  }

  async execute(
    proposal: AgentActionProposal,
    context: TrustedRequestContext,
  ): Promise<ActionExecutionResult> {
    switch (proposal.actionType) {
      case "RUN_SCENARIO": {
        const run = await this.scenarios.createRun(
          context.subjectId,
          {
            scenarioId: proposal.resource.resourceId,
            ...(stringParameter(proposal.parameters.specificationId)
              ? { specificationId: stringParameter(proposal.parameters.specificationId) }
              : {}),
            mode: "NORMAL",
            seed: "BASE",
          },
          context.subjectId,
        );
        this.scheduler.scheduleScenarioRun(context.subjectId, run.id);
        return result("SCENARIO_RUN", run.id, "ACCEPTED", "Запуск анализа принят", `/runs/${encodeURIComponent(run.id)}`);
      }
      case "RETRY_SCENARIO": {
        const runId = requiredRunId(proposal);
        const run = await this.scenarios.retry(context.subjectId, runId);
        this.scheduler.scheduleScenarioRun(context.subjectId, run.id);
        return result("SCENARIO_RUN", run.id, "ACCEPTED", "Повторный запуск принят", `/runs/${encodeURIComponent(run.id)}`);
      }
      case "CREATE_REVIEW_TASK":
        return result("AGENT_TASK", proposal.caseId, "ACCEPTED", "Задание подготовлено в кейсе", `/mtr-analysis?case=${encodeURIComponent(proposal.caseId)}`);
      case "PREPARE_REPORT_DRAFT": {
        const runId = requiredRunId(proposal);
        return result("REPORT_DRAFT", runId, "COMPLETED", "Черновик отчёта доступен для проверки", `/reports/${encodeURIComponent(runId)}`);
      }
      case "PREPARE_EXPORT_DRAFT": {
        const runId = requiredRunId(proposal);
        return result("EXPORT_DRAFT", runId, "COMPLETED", "Черновик экспорта подготовлен", `/reports/${encodeURIComponent(runId)}`);
      }
    }
  }
}

function runIdFrom(proposal: AgentActionProposal): string | null {
  if (proposal.resource.resourceType === "SCENARIO_RUN") return proposal.resource.resourceId;
  return stringParameter(proposal.parameters.runId);
}

function requiredRunId(proposal: AgentActionProposal): string {
  const value = runIdFrom(proposal);
  if (!value) throw new Error("AGENT_ACTION_RUN_REQUIRED");
  return value;
}

function stringParameter(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function result(
  resourceType: string,
  resourceId: string,
  status: ActionExecutionResult["status"],
  safeSummary: string,
  link: string,
): ActionExecutionResult {
  return { resourceType, resourceId, status, safeSummary, link };
}

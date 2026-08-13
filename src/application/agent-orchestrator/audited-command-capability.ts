import type { AuditLogInput } from "@/adapters/persistence/repository";
import type { AgentCommandCapability } from "@/application/agent-orchestrator/orchestrator";
import type { AgentCommandKey } from "@/domain/agent/commands";
import type { AgentExecutionContext } from "@/domain/agent/context";
import type { AgentCommandRequestMap, AgentCommandResultMap } from "@/ports/agent-orchestrator";

export interface AgentCommandAuditPort {
  writeAudit(userId: string, input: AuditLogInput): Promise<unknown>;
}

/** Shared audit boundary for quick commands and natural-language intents. */
export class AuditedAgentCommandCapability implements AgentCommandCapability {
  constructor(
    private readonly delegate: AgentCommandCapability,
    private readonly audit: AgentCommandAuditPort,
    private readonly now: () => number = () => performance.now(),
  ) {}

  async execute<K extends AgentCommandKey>(
    context: AgentExecutionContext,
    request: AgentCommandRequestMap[K] & { readonly commandKey: K },
  ): Promise<AgentCommandResultMap[K]> {
    const auditContext = {
      correlationId: context.correlationId,
      commandKey: request.commandKey,
      projectId: request.context.projectId ?? context.trusted.activeProjectId,
      authorizationVersion: context.trusted.authorizationVersion,
      filters: sanitizedFilters(request.filters),
    };
    await this.write(context, "received", auditContext, { outcome: "SUCCESS" });
    const startedAt = this.now();
    try {
      const execute = this.delegate.execute as unknown as (
        executionContext: AgentExecutionContext,
        commandRequest: AgentCommandRequestMap[AgentCommandKey] & { readonly commandKey: AgentCommandKey },
      ) => Promise<AgentCommandResultMap[AgentCommandKey]>;
      const result = await execute.call(this.delegate, context, request);
      await this.write(context, "completed", auditContext, {
        outcome: "SUCCESS",
        durationMs: elapsedMilliseconds(startedAt, this.now()),
        responseType: result.responseType,
        confidence: result.confidence,
        requiresHumanReview: result.requiresHumanReview,
        citationCount: result.citations.length,
        negativeEvidence: result.negativeEvidence,
      });
      return result as AgentCommandResultMap[K];
    } catch (error) {
      await this.write(context, "failed", auditContext, {
        outcome: "FAILURE",
        durationMs: elapsedMilliseconds(startedAt, this.now()),
        errorCode: safeErrorCode(error),
      });
      throw error;
    }
  }

  private async write(
    context: AgentExecutionContext,
    phase: "received" | "completed" | "failed",
    auditContext: Readonly<Record<string, unknown>>,
    phaseDetails: Readonly<Record<string, unknown>> & Pick<AuditLogInput, "outcome">,
  ): Promise<void> {
    const { outcome, ...details } = phaseDetails;
    await this.audit.writeAudit(context.trusted.subjectId, {
      actorDisplayName: context.trusted.displayName,
      action: `agent.command.${phase}`,
      entityType: "agent_command",
      entityId: String(auditContext.commandKey),
      outcome,
      requestId: context.correlationId,
      details: { ...auditContext, ...details },
    });
  }
}

function sanitizedFilters(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) return { filterKeys: [] };
  const filterKeys = Object.keys(value).sort();
  return {
    filterKeys,
    ...(typeof value.query === "string" ? { hasQuery: value.query.trim().length > 0 } : {}),
    ...(typeof value.materialCode === "string"
      ? { hasMaterialCode: value.materialCode.trim().length > 0 }
      : {}),
    ...arrayCount(value.warehouseIds, "warehouseCount"),
    ...arrayCount(value.levels, "levelCount"),
    ...arrayCount(value.objectTypes, "objectTypeCount"),
    ...arrayCount(value.metricKeys, "metricKeyCount"),
    ...arrayCount(value.statuses, "statusCount"),
    ...arrayCount(value.priorities, "priorityCount"),
    ...(typeof value.horizonDays === "number" ? { horizonDays: value.horizonDays } : {}),
  };
}

function arrayCount(value: unknown, key: string): Record<string, number> {
  return Array.isArray(value) ? { [key]: value.length } : {};
}

function safeErrorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === "string" && /^[A-Z][A-Z0-9_]{1,99}$/.test(error.code)) {
    return error.code;
  }
  return "INTERNAL_FAILURE";
}

function elapsedMilliseconds(startedAt: number, completedAt: number): number {
  return Math.max(0, Math.round(completedAt - startedAt));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

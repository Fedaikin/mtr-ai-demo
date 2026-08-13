import { getRepository, type AuditLogInput, type MtrRepository } from "@/adapters/persistence/repository";
import { AuthorizationError, type TrustedRequestContext } from "@/application/authorization-service";
import { readAgentFeaturePolicy } from "@/application/agent-orchestrator/feature-policy";
import {
  AgentCommandExecutionError,
} from "@/application/agent-orchestrator/command-registry";
import {
  parseAgentCommandRequest,
  AgentCommandInputError,
} from "@/application/agent-orchestrator/command-schemas";
import type { AgentCommandOrchestratorRequest } from "@/application/agent-orchestrator/orchestrator";
import { AgentContextError } from "@/domain/agent/context";
import type { AgentCommandKey } from "@/domain/agent/commands";
import type { AgentCommandRequestMap } from "@/ports/agent-orchestrator";
import { ApiError, ok, parseJson, toErrorResponse } from "@/lib/api";
import { requirePermission } from "@/lib/session";

import { createMtrAgentOrchestrator } from "../../_shared";

export const dynamic = "force-dynamic";

interface CommandRouteContext {
  readonly params: Promise<{ commandKey: string }>;
}

export async function POST(request: Request, { params }: CommandRouteContext) {
  try {
    assertFeatureEnabled();
    const [routeParams, body, session, repository] = await Promise.all([
      params,
      parseJson(request),
      requirePermission("agent.chat"),
      getRepository(),
    ]);
    const input = parseAgentCommandRequest(routeParams.commandKey, body);
    const correlationId = `agent-command-${crypto.randomUUID()}`;
    const projectId = input.context.projectId ?? session.authorization.activeProjectId;
    const auditContext: CommandAuditContext = {
      correlationId,
      commandKey: input.commandKey,
      projectId,
      authorization: session.authorization,
      filters: sanitizedFilters(input.filters),
    };

    await writeCommandAudit(repository, auditContext, "received", {
      outcome: "SUCCESS",
    });

    const startedAt = performance.now();
    try {
      const orchestrator = createMtrAgentOrchestrator(repository);
      const result = await orchestrator.handle(
        toOrchestratorRequest(input.commandKey, input.context, input.filters, correlationId),
        session.authorization,
      );
      if (result.kind !== "COMMAND") {
        throw new Error("COMMAND_CHANNEL_RESULT_MISMATCH");
      }
      await writeCommandAudit(repository, auditContext, "completed", {
        outcome: "SUCCESS",
        durationMs: elapsedMilliseconds(startedAt),
        responseType: result.output.responseType,
        confidence: result.output.confidence,
        requiresHumanReview: result.output.requiresHumanReview,
        citationCount: result.output.citations.length,
        negativeEvidence: result.output.negativeEvidence,
      });
      return ok(result.output, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      await writeCommandAudit(repository, auditContext, "failed", {
        outcome: "FAILURE",
        durationMs: elapsedMilliseconds(startedAt),
        errorCode: safeErrorCode(error),
      });
      throw error;
    }
  } catch (error) {
    return commandErrorResponse(error);
  }
}

interface CommandAuditContext {
  readonly correlationId: string;
  readonly commandKey: AgentCommandKey;
  readonly projectId: string | null;
  readonly authorization: TrustedRequestContext;
  readonly filters: Readonly<Record<string, unknown>>;
}

async function writeCommandAudit(
  repository: MtrRepository,
  context: CommandAuditContext,
  phase: "received" | "completed" | "failed",
  phaseDetails: Readonly<Record<string, unknown>> & Pick<AuditLogInput, "outcome">,
): Promise<void> {
  const { outcome, ...details } = phaseDetails;
  await repository.writeAudit(context.authorization.subjectId, {
    actorDisplayName: context.authorization.displayName,
    action: `agent.command.${phase}`,
    entityType: "agent_command",
    entityId: context.commandKey,
    outcome,
    requestId: context.correlationId,
    details: {
      correlationId: context.correlationId,
      commandKey: context.commandKey,
      projectId: context.projectId,
      authorizationVersion: context.authorization.authorizationVersion,
      filters: context.filters,
      ...details,
    },
  });
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

function toOrchestratorRequest<K extends AgentCommandKey>(
  commandKey: K,
  selection: AgentCommandRequestMap[K]["context"],
  filters: AgentCommandRequestMap[K]["filters"] | undefined,
  correlationId: string,
): AgentCommandOrchestratorRequest {
  return {
    kind: "COMMAND",
    commandKey,
    selection,
    ...(filters === undefined ? {} : { filters }),
    correlationId,
  } as AgentCommandOrchestratorRequest;
}

function assertFeatureEnabled(): void {
  const policy = readAgentFeaturePolicy();
  if (!policy.orchestratorEnabled) {
    throw new ApiError(404, "MTR_AGENT_ORCHESTRATOR_DISABLED", "Команды МТР-агента недоступны");
  }
  if (!policy.executionAllowed) {
    throw new ApiError(503, "MTR_AGENT_KILL_SWITCH_ACTIVE", "Выполнение команд МТР-агента временно остановлено");
  }
}

function commandErrorResponse(error: unknown) {
  if (error instanceof AgentCommandInputError) {
    return toErrorResponse(new ApiError(404, error.code, error.message));
  }
  if (error instanceof AgentContextError) {
    return toErrorResponse(new ApiError(403, error.code, error.message));
  }
  if (error instanceof AuthorizationError) {
    return toErrorResponse(new ApiError(403, "AGENT_PERMISSION_DENIED", error.message));
  }
  if (error instanceof AgentCommandExecutionError) {
    const status = error.code === "AGENT_COMMAND_NOT_REGISTERED"
      ? 404
      : error.code === "AGENT_SELECTION_STALE"
        ? 409
        : 403;
    return toErrorResponse(new ApiError(status, error.code, error.message));
  }
  return toErrorResponse(error);
}

function safeErrorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === "string" && /^[A-Z][A-Z0-9_]{1,99}$/.test(error.code)) {
    return error.code;
  }
  return "INTERNAL_FAILURE";
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

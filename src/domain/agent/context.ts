import type { TrustedRequestContext } from "@/application/authorization-service";

export interface AgentContextSelection {
  readonly projectId?: string;
  readonly specificationId?: string;
  readonly positionId?: string;
  readonly runId?: string;
  readonly period?: Readonly<{ from: string; to: string }>;
}

export interface AgentExecutionContext {
  readonly trusted: TrustedRequestContext;
  readonly selection: AgentContextSelection;
  readonly locale: "ru-RU";
  readonly timezone: string;
  readonly warehouseScopeIds: readonly string[];
  readonly correlationId: string;
}

export interface CreateAgentExecutionContextInput {
  readonly selection?: AgentContextSelection;
  readonly timezone?: string;
  readonly warehouseScopeIds?: readonly string[];
  readonly correlationId?: string;
}

export function createAgentExecutionContext(
  trusted: TrustedRequestContext,
  input: CreateAgentExecutionContextInput = {},
): AgentExecutionContext {
  const selection = Object.freeze({ ...input.selection });
  if (selection.projectId !== undefined && selection.projectId !== trusted.activeProjectId) {
    throw new AgentContextError("AGENT_PROJECT_CONTEXT_DENIED");
  }

  const allowedWarehouseIds = new Set(trusted.accessClaims.warehouseIds ?? []);
  const requestedWarehouseIds = input.warehouseScopeIds ?? [...allowedWarehouseIds];
  if (requestedWarehouseIds.some((warehouseId) => !allowedWarehouseIds.has(warehouseId))) {
    throw new AgentContextError("AGENT_WAREHOUSE_SCOPE_DENIED");
  }

  return Object.freeze({
    trusted,
    selection,
    locale: "ru-RU",
    timezone: input.timezone ?? "Europe/Moscow",
    warehouseScopeIds: Object.freeze([...requestedWarehouseIds]),
    correlationId: input.correlationId ?? trusted.requestId,
  });
}

export class AgentContextError extends Error {
  constructor(
    readonly code: "AGENT_PROJECT_CONTEXT_DENIED" | "AGENT_WAREHOUSE_SCOPE_DENIED",
  ) {
    super("Контекст МТР-агента недоступен");
    this.name = "AgentContextError";
  }
}

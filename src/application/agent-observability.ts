import type { GroundedCitation, IntegrationState, ScenarioRun } from "@/domain/models";
import { redactSensitiveData, redactSensitiveRecord } from "@/lib/redaction";

export interface AgentAuditEntry {
  id: string;
  userId: string;
  actorDisplayName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  outcome: string;
  details: Record<string, unknown>;
  occurredAt: string;
  requestId: string | null;
}

export interface AgentOperationFilters {
  from?: string;
  to?: string;
  user?: string;
  scenario?: string;
  tool?: string;
  status?: "SUCCESS" | "FAILURE";
  errorType?: string;
  correlationId?: string;
}

export interface AgentOperation {
  id: string;
  occurredAt: string;
  userId: string;
  actorDisplayName: string;
  conversationId: string | null;
  runId: string | null;
  entityId: string | null;
  tool: string;
  arguments: unknown;
  result: unknown;
  durationMs: number | null;
  status: "SUCCESS" | "FAILURE";
  attempts: number;
  promptVersion: string;
  model: string;
  citations: GroundedCitation[];
  errorCode: string | null;
  errorMessage: string | null;
  correlationId: string;
}

export interface AgentObservabilityMetrics {
  agentState: "READY" | "PROCESSING" | "DEGRADED";
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseMs: number | null;
  p50ResponseMs: number | null;
  p95ResponseMs: number | null;
  toolCalls: number;
  retries: number;
  expertReviews: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  activeScenarios: number;
}

export type AgentAuditMetricsSummary = Omit<
  AgentObservabilityMetrics,
  "agentState" | "activeScenarios"
>;

const TERMINAL_RUN_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
const REQUIRED_INTEGRATIONS: ReadonlySet<IntegrationState["system"]> = new Set([
  "LLM",
  "APPIUS",
  "SAP",
  "RAG",
]);

export function buildAgentObservability(
  entries: AgentAuditEntry[],
  integrationStates: IntegrationState[],
  runs: ScenarioRun[],
): AgentObservabilityMetrics {
  const agentEntries = entries.filter((entry) => entry.action.startsWith("agent."));
  const requestEntries = agentEntries.filter((entry) => entry.action === "agent.request.received");
  const responseEntries = agentEntries.filter((entry) => entry.action === "agent.response.completed");
  const toolResults = agentEntries.filter((entry) => entry.action === "agent.tool.result");
  const failedCorrelations = new Set(
    agentEntries
      .filter((entry) => entry.outcome === "FAILURE")
      .flatMap((entry) => explicitCorrelationId(entry) ?? []),
  );
  const completedCorrelations = new Set(
    responseEntries.flatMap((entry) => explicitCorrelationId(entry) ?? []),
  );
  const requestCorrelations = requestEntries.flatMap(
    (entry) => explicitCorrelationId(entry) ?? [],
  );
  const correlatedFailedRequests = requestCorrelations.filter(
    (id) => failedCorrelations.has(id) || !completedCorrelations.has(id),
  ).length;
  const correlatedSuccessfulRequests = requestCorrelations.filter(
    (id) => completedCorrelations.has(id) && !failedCorrelations.has(id),
  ).length;
  const legacyRequestCount = requestEntries.filter((entry) => !explicitCorrelationId(entry)).length;
  const legacyResponseCount = responseEntries.filter((entry) => !explicitCorrelationId(entry)).length;
  const legacySuccessfulRequests = Math.min(legacyRequestCount, legacyResponseCount);
  const successfulRequests = correlatedSuccessfulRequests + legacySuccessfulRequests;
  const failedRequests = correlatedFailedRequests + legacyRequestCount - legacySuccessfulRequests;
  const durations = responseEntries
    .map((entry) => numberValue(entry.details.durationMs))
    .filter((value): value is number => value !== null);
  const successes = agentEntries.filter((entry) => entry.outcome === "SUCCESS");
  const failures = agentEntries.filter((entry) => entry.outcome === "FAILURE");

  return buildAgentObservabilityFromSummary({
    totalRequests: requestEntries.length,
    successfulRequests,
    failedRequests,
    averageResponseMs: durations.length ? Math.round(mean(durations)) : null,
    p50ResponseMs: percentile(durations, 0.5),
    p95ResponseMs: percentile(durations, 0.95),
    toolCalls: toolResults.length,
    retries: toolResults.reduce(
      (total, entry) => total + Math.max(0, (numberValue(entry.details.attempts) ?? 1) - 1),
      0,
    ),
    expertReviews: responseEntries.filter(
      (entry) => entry.details.requiresHumanReview === true,
    ).length,
    lastSuccessAt: latestAt(successes),
    lastFailureAt: latestAt(failures),
  }, integrationStates, runs);
}

/** Combines exact SQL audit aggregates with current operational state. */
export function buildAgentObservabilityFromSummary(
  summary: AgentAuditMetricsSummary,
  integrationStates: IntegrationState[],
  runs: ScenarioRun[],
): AgentObservabilityMetrics {
  const activeScenarios = runs.filter((run) => !TERMINAL_RUN_STATUSES.has(run.status)).length;
  const reportedSystems = new Set(integrationStates.map((state) => state.system));
  const degraded =
    [...REQUIRED_INTEGRATIONS].some((system) => !reportedSystems.has(system)) ||
    integrationStates.some((state) => state.state !== "AVAILABLE");

  return {
    ...summary,
    agentState: degraded ? "DEGRADED" : activeScenarios > 0 ? "PROCESSING" : "READY",
    activeScenarios,
  };
}

export function buildAgentOperations(
  entries: AgentAuditEntry[],
  filters: AgentOperationFilters = {},
): AgentOperation[] {
  return entries
    .filter((entry) => entry.action === "agent.tool.result")
    .map(toOperation)
    .filter((operation) => matchesFilters(operation, filters))
    .toSorted((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

function toOperation(entry: AgentAuditEntry): AgentOperation {
  const details = redactSensitiveRecord(entry.details);
  return {
    id: entry.id,
    occurredAt: entry.occurredAt,
    userId: entry.userId,
    actorDisplayName: entry.actorDisplayName,
    conversationId: stringValue(details.conversationId),
    runId: stringValue(details.runId),
    entityId: entry.entityId,
    tool: stringValue(details.tool) ?? "agent.operation",
    arguments: compactAuditValue(redactSensitiveData(details.arguments ?? {})),
    result: compactAuditValue(redactSensitiveData(details.result ?? {})),
    durationMs: numberValue(details.durationMs),
    status: entry.outcome === "FAILURE" ? "FAILURE" : "SUCCESS",
    attempts: Math.max(1, numberValue(details.attempts) ?? 1),
    promptVersion: stringValue(details.promptVersion) ?? "mtr-agent-system-v1",
    model: stringValue(details.model) ?? "Mock LLM",
    citations: citationValues(details.citations),
    errorCode: stringValue(details.errorCode),
    errorMessage: stringValue(details.errorMessage),
    correlationId: correlationIdOf(entry),
  };
}

function matchesFilters(operation: AgentOperation, filters: AgentOperationFilters): boolean {
  const from = parseDateBoundary(filters.from, false);
  const to = parseDateBoundary(filters.to, true);
  const occurredAt = Date.parse(operation.occurredAt);
  if (from !== null && occurredAt < from) return false;
  if (to !== null && occurredAt > to) return false;
  if (filters.status && operation.status !== filters.status) return false;
  if (filters.user && !includesAny(`${operation.userId} ${operation.actorDisplayName}`, filters.user)) return false;
  if (filters.scenario && !includesAny(`${operation.runId ?? ""} ${operation.entityId ?? ""}`, filters.scenario)) return false;
  if (filters.tool && !includesAny(operation.tool, filters.tool)) return false;
  if (filters.errorType && !includesAny(operation.errorCode ?? "", filters.errorType)) return false;
  if (filters.correlationId && !includesAny(operation.correlationId, filters.correlationId)) return false;
  return true;
}

function correlationIdOf(entry: AgentAuditEntry): string {
  return explicitCorrelationId(entry) ?? entry.id;
}

function explicitCorrelationId(entry: AgentAuditEntry): string | null {
  return entry.requestId ?? stringValue(entry.details.correlationId);
}

function citationValues(value: unknown): GroundedCitation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const sourceSystem = stringValue(item.sourceSystem);
    const entityId = stringValue(item.entityId);
    const versionOrSnapshot = stringValue(item.versionOrSnapshot);
    if (!sourceSystem || !entityId || !versionOrSnapshot) return [];
    if (!["APPIUS", "SAP", "CATALOG", "NORMATIVE", "SCENARIO", "REPORT"].includes(sourceSystem)) return [];
    return [{
      sourceSystem: sourceSystem as GroundedCitation["sourceSystem"],
      entityId,
      versionOrSnapshot,
      clauseId: stringValue(item.clauseId),
    }];
  });
}

function latestAt(entries: AgentAuditEntry[]): string | null {
  return entries.reduce<string | null>(
    (latest, entry) => (!latest || entry.occurredAt > latest ? entry.occurredAt : latest),
    null,
  );
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return Math.round(sorted[index] ?? 0);
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function parseDateBoundary(value: string | undefined, endOfDay: boolean): number | null {
  if (!value) return null;
  const parsed = Date.parse(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function includesAny(value: string, query: string): boolean {
  return value.toLocaleLowerCase("ru-RU").includes(query.trim().toLocaleLowerCase("ru-RU"));
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || ["undefined", "null"].includes(trimmed.toLocaleLowerCase("en-US"))) {
    return null;
  }
  return trimmed.slice(0, 500);
}

function compactAuditValue(value: unknown): unknown {
  if (typeof value === "string") return stringValue(value);
  if (Array.isArray(value)) {
    return value.map(compactAuditValue).filter((item) => item !== null);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, child]) => {
        const compacted = compactAuditValue(child);
        return compacted === null ? [] : [[key, compacted]];
      }),
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import "server-only";

import { and, asc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";

import { getDatabase, type Database } from "@/adapters/persistence/db";
import {
  agentMetricEvents,
  positionAnalysisResults,
  scenarioRuns,
  specifications,
  specificationVersions,
} from "@/adapters/persistence/schema";
import type { AgentExecutionContext } from "@/domain/agent/context";
import type {
  DigestKpiChange,
  DigestPositionChange,
  DigestSourceState,
  DigestSpecificationChange,
} from "@/domain/agent/digest";
import type {
  WeeklyDigestSourcePort,
  WeeklyDigestSourceReadQuery,
  WeeklyDigestSourceSnapshot,
} from "@/ports/agent-tasks";

const DEMO_TENANT_ID = "demo-tenant-001";

export async function createWeeklyDigestSourcePort(): Promise<WeeklyDigestSourcePort> {
  return new PersistenceWeeklyDigestSourcePort(await getDatabase());
}

export class PersistenceWeeklyDigestSourcePort implements WeeklyDigestSourcePort {
  constructor(private readonly database: Database) {}

  async read(
    context: AgentExecutionContext,
    query: WeeklyDigestSourceReadQuery,
  ): Promise<WeeklyDigestSourceSnapshot> {
    assertTrustedScope(context, query);
    const snapshotAt = new Date().toISOString();
    const from = query.previousPeriod.from;
    const to = query.period.to;

    const [specificationsResult, positionsResult, kpiResult] = await Promise.allSettled([
      context.trusted.permissionKeys.has("specification.read")
        ? this.readSpecifications(query, from, to)
        : Promise.resolve([]),
      context.trusted.permissionKeys.has("analysis.read")
        ? this.readPositionChanges(query, from, to)
        : Promise.resolve([]),
      context.trusted.permissionKeys.has("analysis.read")
        ? this.readKpiChanges(query, from, to)
        : Promise.resolve({ items: [], invalidRows: 0 }),
    ]);

    const specificationChanges = settledItems(specificationsResult);
    const positionChanges = settledItems(positionsResult);
    const kpiPayload = kpiResult.status === "fulfilled"
      ? kpiResult.value
      : { items: [] as DigestKpiChange[], invalidRows: 0 };

    return {
      snapshotAt,
      sources: {
        specifications: settledState(specificationsResult, snapshotAt, "DIGEST_SPECIFICATIONS_UNAVAILABLE"),
        positions: settledState(positionsResult, snapshotAt, "DIGEST_POSITIONS_UNAVAILABLE"),
        kpi: kpiResult.status === "rejected"
          ? unavailableState(snapshotAt, "DIGEST_KPI_UNAVAILABLE")
          : kpiPayload.invalidRows > 0
            ? partialState(snapshotAt, "DIGEST_KPI_ROWS_UNSUPPORTED")
            : completeState(snapshotAt),
      },
      specificationChanges,
      positionChanges,
      kpiChanges: kpiPayload.items,
    };
  }

  private async readSpecifications(
    query: WeeklyDigestSourceReadQuery,
    from: string,
    to: string,
  ): Promise<DigestSpecificationChange[]> {
    const rows = await this.database
      .select({ specification: specifications, version: specificationVersions })
      .from(specificationVersions)
      .innerJoin(
        specifications,
        and(
          eq(specifications.id, specificationVersions.specificationId),
          eq(specifications.userId, query.subjectId),
          sql`${specifications}."project_id" = ${query.projectId}`,
        ),
      )
      .where(and(
        eq(specificationVersions.userId, query.subjectId),
        sql`${specificationVersions}."project_id" = ${query.projectId}`,
        gte(specificationVersions.updatedAt, from),
        lt(specificationVersions.updatedAt, to),
      ))
      .orderBy(asc(specificationVersions.updatedAt), asc(specificationVersions.id));

    return rows.map(({ specification, version }) => ({
      id: `specification-version:${version.id}`,
      projectId: query.projectId,
      specificationId: specification.id,
      title: version.versionNumber === 1
        ? `Создана спецификация «${safeText(specification.name, "Без названия") }»`
        : `Обновлена спецификация «${safeText(specification.name, "Без названия") }»`,
      changeType: version.versionNumber === 1 ? "NEW" : "UPDATED",
      version: `v${version.versionNumber}`,
      visibility: version.isCurrent && version.status === "ACTIVE" ? "PUBLISHED" : "PROJECT",
      affectedSubjectIds: [],
      occurredAt: isoTimestamp(version.updatedAt),
    }));
  }

  private async readPositionChanges(
    query: WeeklyDigestSourceReadQuery,
    from: string,
    to: string,
  ): Promise<DigestPositionChange[]> {
    const rows = await this.database
      .select({ result: positionAnalysisResults, specificationId: scenarioRuns.specificationId })
      .from(positionAnalysisResults)
      .innerJoin(
        scenarioRuns,
        and(
          eq(scenarioRuns.id, positionAnalysisResults.runId),
          eq(scenarioRuns.userId, query.subjectId),
          eq(scenarioRuns.projectId, query.projectId),
        ),
      )
      .where(and(
        eq(positionAnalysisResults.userId, query.subjectId),
        gte(positionAnalysisResults.updatedAt, from),
        lt(positionAnalysisResults.updatedAt, to),
        or(
          eq(positionAnalysisResults.requiresHumanReview, true),
          eq(positionAnalysisResults.status, "INSUFFICIENT"),
          eq(positionAnalysisResults.status, "NOT_FOUND"),
        ),
      ))
      .orderBy(asc(positionAnalysisResults.updatedAt), asc(positionAnalysisResults.id));

    return rows.map(({ result, specificationId }) => {
      const shortage = result.status === "INSUFFICIENT" || result.status === "NOT_FOUND";
      return {
        id: `analysis-result:${result.id}`,
        projectId: query.projectId,
        specificationId,
        positionId: result.positionId,
        kind: shortage ? "SHORTAGE" : "EXPERT_REVIEW",
        title: shortage ? "Обнаружен возможный дефицит позиции" : "Позиция требует экспертной проверки",
        affectedSubjectIds: [query.subjectId],
        occurredAt: isoTimestamp(result.updatedAt),
      };
    });
  }

  private async readKpiChanges(
    query: WeeklyDigestSourceReadQuery,
    from: string,
    to: string,
  ): Promise<{ items: DigestKpiChange[]; invalidRows: number }> {
    const rows = await this.database
      .select()
      .from(agentMetricEvents)
      .where(and(
        eq(agentMetricEvents.tenantId, DEMO_TENANT_ID),
        eq(agentMetricEvents.projectId, query.projectId),
        or(eq(agentMetricEvents.actorUserId, query.subjectId), isNull(agentMetricEvents.actorUserId)),
        gte(agentMetricEvents.occurredAt, from),
        lt(agentMetricEvents.occurredAt, to),
      ))
      .orderBy(asc(agentMetricEvents.occurredAt), asc(agentMetricEvents.id));

    const items: DigestKpiChange[] = [];
    let invalidRows = 0;
    for (const row of rows) {
      const projected = metricChange(row, query.subjectId);
      if (projected) items.push(projected);
      else invalidRows += 1;
    }
    return { items, invalidRows };
  }
}

function assertTrustedScope(context: AgentExecutionContext, query: WeeklyDigestSourceReadQuery): void {
  if (
    query.subjectId !== context.trusted.subjectId ||
    query.projectId !== context.trusted.activeProjectId
  ) {
    throw new Error("DIGEST_SCOPE_DENIED");
  }
}

function metricChange(
  row: typeof agentMetricEvents.$inferSelect,
  subjectId: string,
): DigestKpiChange | null {
  const attributes = row.attributes;
  const currentValue = finiteNumber(attributes.currentValue);
  if (currentValue === null) return null;
  const scope = attributes.scope;
  if (scope !== "PERSONAL" && scope !== "EXPERT" && scope !== "PROJECT") return null;
  const eventSubjectId = typeof attributes.subjectId === "string" ? attributes.subjectId : row.actorUserId;
  if (eventSubjectId && eventSubjectId !== subjectId) return null;
  const previousValue = attributes.previousValue === null || attributes.previousValue === undefined
    ? null
    : finiteNumber(attributes.previousValue);
  if (attributes.previousValue !== null && attributes.previousValue !== undefined && previousValue === null) {
    return null;
  }
  return {
    id: row.id,
    projectId: row.projectId,
    subjectId: scope === "PROJECT" ? null : subjectId,
    scope,
    label: safeText(attributes.label, "Показатель проекта"),
    currentValue,
    previousValue,
    unit: safeText(attributes.unit, ""),
    occurredAt: isoTimestamp(row.occurredAt),
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const text = value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, 160);
  return text || fallback;
}

function isoTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("DIGEST_TIMESTAMP_INVALID");
  return new Date(timestamp).toISOString();
}

function settledItems<T>(result: PromiseSettledResult<T[]>): T[] {
  return result.status === "fulfilled" ? result.value : [];
}

function settledState<T>(
  result: PromiseSettledResult<T>,
  snapshotAt: string,
  code: string,
): DigestSourceState {
  return result.status === "fulfilled" ? completeState(snapshotAt) : unavailableState(snapshotAt, code);
}

function completeState(snapshotAt: string): DigestSourceState {
  return { availability: "COMPLETE", complete: true, snapshotAt, missingData: [] };
}

function partialState(snapshotAt: string, code: string): DigestSourceState {
  return {
    availability: "PARTIAL",
    complete: false,
    snapshotAt,
    missingData: [{ code, message: "Часть записей источника не поддерживается" }],
  };
}

function unavailableState(snapshotAt: string, code: string): DigestSourceState {
  return {
    availability: "UNAVAILABLE",
    complete: false,
    snapshotAt,
    missingData: [{ code, message: "Источник временно недоступен" }],
  };
}

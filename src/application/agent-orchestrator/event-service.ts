import "server-only";

import { createHash } from "node:crypto";

import {
  requirePermission,
  type TrustedRequestContext,
} from "@/application/authorization-service";
import type { AgentExecutionContext } from "@/domain/agent/context";
import {
  AGENT_PLATFORM_EVENT_TYPES,
  type AgentEventInboxRecord,
  type AgentInsightLevel,
  type AgentPlatformEvent,
  type AgentProactiveInsightRecord,
  type PublicAgentProactiveInsight,
} from "@/domain/agent/events";

export interface AgentEventStore {
  enqueue(event: AgentEventInboxRecord): Promise<AgentEventInboxRecord>;
  peekNext(projectId: string): Promise<AgentEventInboxRecord | null>;
  claimNext(projectId: string, eventId: string): Promise<AgentEventInboxRecord | null>;
  completeWithInsight(event: AgentEventInboxRecord, insight: AgentProactiveInsightRecord): Promise<AgentProactiveInsightRecord>;
  fail(event: AgentEventInboxRecord, safeErrorCode: string): Promise<AgentEventInboxRecord>;
  findInsight(projectId: string, eventType: string, entityId: string, stateVersion: string): Promise<AgentProactiveInsightRecord | null>;
  listInsights(subjectId: string, projectId: string): Promise<readonly AgentProactiveInsightRecord[]>;
}

export interface IngestAgentEventInput {
  readonly sourceSystem: AgentPlatformEvent["sourceSystem"];
  readonly sourceEventId: string;
  readonly eventType: AgentPlatformEvent["eventType"];
  readonly projectId: string;
  readonly entityId: string;
  readonly stateVersion: string;
  readonly occurredAt: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export class AgentEventService {
  constructor(
    private readonly store: AgentEventStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ingest(input: IngestAgentEventInput, context: TrustedRequestContext): Promise<AgentEventInboxRecord> {
    validateInput(input);
    if (input.projectId !== context.activeProjectId) throw new AgentEventServiceError("AGENT_EVENT_PROJECT_DENIED");
    requireSourcePermission(input.sourceSystem, context);
    const receivedAt = this.now().toISOString();
    const idempotencyKey = hash([input.sourceSystem, input.sourceEventId]);
    return this.store.enqueue({
      id: `event-${idempotencyKey.slice(0, 24)}`,
      tenantId: "demo-tenant-001",
      sourceSystem: input.sourceSystem,
      sourceEventId: safeIdentifier(input.sourceEventId),
      eventType: input.eventType,
      projectId: input.projectId,
      entityId: safeIdentifier(input.entityId),
      stateVersion: safeIdentifier(input.stateVersion),
      occurredAt: input.occurredAt,
      payload: safePayload(input.payload ?? {}),
      idempotencyKey,
      correlationId: context.requestId,
      actorSubjectId: context.subjectId,
      status: "PENDING",
      attempts: 0,
      maxAttempts: 5,
      availableAt: receivedAt,
      receivedAt,
      processedAt: null,
      safeErrorCode: null,
      authorizationVersion: context.authorizationVersion,
      roleAssignmentSnapshot: [...context.activeRoleAssignmentIds],
      version: 1,
    });
  }

  async execute(
    context: AgentExecutionContext,
    request: {
      readonly eventId: string;
      readonly eventType: string;
      readonly entityId: string;
      readonly stateVersion: string;
      readonly occurredAt: string;
    },
  ): Promise<PublicAgentProactiveInsight> {
    const projectId = context.trusted.activeProjectId;
    if (!projectId) throw new AgentEventServiceError("AGENT_EVENT_PROJECT_DENIED");
    const event = await this.store.claimNext(projectId, request.eventId);
    if (!event) {
      const queued = await this.store.peekNext(projectId);
      const existing = queued?.id === request.eventId
        ? null
        : await this.store.findInsight(
            projectId,
            request.eventType,
            request.entityId,
            request.stateVersion,
          );
      if (existing) return publicInsight(existing);
      throw new AgentEventServiceError("AGENT_EVENT_QUEUE_EMPTY");
    }
    if (event.eventType !== request.eventType || event.entityId !== request.entityId) {
      await this.store.fail(event, "AGENT_EVENT_SELECTION_MISMATCH");
      throw new AgentEventServiceError("AGENT_EVENT_SELECTION_MISMATCH");
    }
    try {
      requireSourcePermission(event.sourceSystem, context.trusted);
      const insight = buildInsight(event, context.trusted, this.now());
      return publicInsight(await this.store.completeWithInsight(event, insight));
    } catch (error) {
      await this.store.fail(event, safeErrorCode(error));
      throw error;
    }
  }

  async listInsights(context: TrustedRequestContext): Promise<readonly PublicAgentProactiveInsight[]> {
    requirePermission(context, "agent.chat");
    requirePermission(context, "project.read");
    if (!context.activeProjectId) throw new AgentEventServiceError("AGENT_EVENT_PROJECT_DENIED");
    const rows = await this.store.listInsights(context.subjectId, context.activeProjectId);
    return Object.freeze(rows.map(publicInsight));
  }
}

export class AgentEventServiceError extends Error {
  constructor(
    readonly code:
      | "AGENT_EVENT_VALIDATION_ERROR"
      | "AGENT_EVENT_PROJECT_DENIED"
      | "AGENT_EVENT_SOURCE_DENIED"
      | "AGENT_EVENT_QUEUE_EMPTY"
      | "AGENT_EVENT_SELECTION_MISMATCH",
  ) {
    super("Событие МТР-агента недоступно");
    this.name = "AgentEventServiceError";
  }
}

function buildInsight(
  event: AgentEventInboxRecord,
  context: TrustedRequestContext,
  now: Date,
): AgentProactiveInsightRecord {
  const template = insightTemplate(event);
  const deduplicationKey = hash([event.projectId, event.eventType, event.entityId]);
  const observedAt = now.toISOString();
  return {
    id: `insight-${deduplicationKey.slice(0, 24)}`,
    tenantId: event.tenantId,
    projectId: event.projectId,
    caseId: stringValue(event.payload.caseId),
    subjectUserId: stringValue(event.payload.subjectUserId),
    triggerType: event.eventType,
    stateVersion: event.stateVersion,
    level: template.level,
    status: "ACTIVE",
    targetType: template.targetType,
    targetId: event.entityId,
    title: template.title,
    summary: template.summary,
    recommendedAction: template.recommendedAction,
    evidenceFactIds: stringArray(event.payload.evidenceFactIds),
    deduplicationKey,
    ruleVersion: "mtr-agent-insight-rules-v1",
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
    cooldownUntil: new Date(now.getTime() + 60 * 60_000).toISOString(),
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000).toISOString(),
    authorizationVersion: context.authorizationVersion,
    roleAssignmentSnapshot: [...context.activeRoleAssignmentIds],
    createdBySubjectId: context.subjectId,
    version: 1,
  };
}

function insightTemplate(event: AgentEventInboxRecord): {
  level: AgentInsightLevel;
  targetType: string;
  title: string;
  summary: string;
  recommendedAction: string;
} {
  switch (event.eventType) {
    case "SCENARIO_FAILED":
      return { level: "HIGH", targetType: "SCENARIO_RUN", title: "Анализ требует внимания", summary: "Запуск завершился с подтверждённой ошибкой процесса.", recommendedAction: "Откройте запуск и проверьте безопасную причину перед повтором." };
    case "SLA_BREACHED":
      return { level: "HIGH", targetType: "PROCESS", title: "Нарушен целевой срок", summary: "Versioned process event подтвердил превышение SLA.", recommendedAction: "Проверьте этап и назначьте владельца следующего действия." };
    case "RISK_LEVEL_RAISED":
      return { level: levelValue(event.payload.level), targetType: "RISK", title: "Уровень риска повышен", summary: "Детерминированное правило риска зафиксировало изменение уровня.", recommendedAction: "Откройте evidence риска и проверьте рекомендуемые действия." };
    case "DUE_DATE_APPROACHING":
      return { level: "MEDIUM", targetType: "TASK", title: "Приближается срок задания", summary: "До контрольного срока осталось ограниченное время.", recommendedAction: "Откройте личное задание и уточните готовность решения." };
    case "SAP_SNAPSHOT_RECEIVED":
      return { level: "LOW", targetType: "STOCK_SNAPSHOT", title: "Получен новый снимок остатков", summary: "Доступен новый versioned снимок разрешённого источника SAP.", recommendedAction: "Обновите расчёт покрытия для затронутых позиций." };
    case "APPIUS_VERSION_PUBLISHED":
      return { level: "MEDIUM", targetType: "SPECIFICATION_VERSION", title: "Опубликована новая версия спецификации", summary: "Appius подтвердил новую актуальную версию.", recommendedAction: "Проверьте изменения и при необходимости запустите новый анализ." };
    case "SCENARIO_COMPLETED":
      return { level: "LOW", targetType: "SCENARIO_RUN", title: "Анализ завершён", summary: "Запуск перешёл в терминальное успешное состояние.", recommendedAction: "Откройте отчёт и позиции, требующие участия человека." };
    case "INTEGRATION_RECOVERED":
      return { level: "LOW", targetType: "INTEGRATION", title: "Источник снова доступен", summary: "Интеграция восстановила доступность.", recommendedAction: "Повторите только ранее заблокированные проверки." };
  }
}

function requireSourcePermission(
  sourceSystem: AgentPlatformEvent["sourceSystem"],
  context: TrustedRequestContext,
): void {
  const permission = sourceSystem === "APPIUS"
    ? "source.appius.read"
    : sourceSystem === "SAP"
      ? "source.sap.read"
      : sourceSystem === "RISK_ENGINE"
        ? "source.rag.read"
        : "sink.siem.write";
  if (!context.permissionKeys.has(permission)) throw new AgentEventServiceError("AGENT_EVENT_SOURCE_DENIED");
}

function validateInput(input: IngestAgentEventInput): void {
  if (!(AGENT_PLATFORM_EVENT_TYPES as readonly string[]).includes(input.eventType)) invalid();
  if (!Number.isFinite(Date.parse(input.occurredAt))) invalid();
  safeIdentifier(input.projectId);
  safeIdentifier(input.sourceEventId);
  safeIdentifier(input.entityId);
  safeIdentifier(input.stateVersion);
}

function safeIdentifier(value: string): string {
  const safe = value.trim();
  if (!safe || safe.length > 240 || /[\u0000-\u001f\u007f]/u.test(safe)) invalid();
  return safe;
}

function safePayload(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const allowed = new Set(["caseId", "subjectUserId", "level", "evidenceFactIds", "safeReason"]);
  return Object.freeze(Object.fromEntries(Object.entries(value).filter(([key]) => allowed.has(key))));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 240) : null;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 240)).slice(0, 50)
    : [];
}

function levelValue(value: unknown): AgentInsightLevel {
  return value === "CRITICAL" || value === "HIGH" || value === "MEDIUM" || value === "LOW"
    ? value
    : "HIGH";
}

function publicInsight(row: AgentProactiveInsightRecord): PublicAgentProactiveInsight {
  return {
    id: row.id,
    level: row.level,
    status: row.status,
    targetType: row.targetType,
    targetId: row.targetId,
    title: row.title,
    summary: row.summary,
    recommendedAction: row.recommendedAction,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    ruleVersion: row.ruleVersion,
  };
}

function hash(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex");
}

function safeErrorCode(error: unknown): string {
  return error instanceof AgentEventServiceError ? error.code : "AGENT_EVENT_PROCESSING_FAILED";
}

function invalid(): never {
  throw new AgentEventServiceError("AGENT_EVENT_VALIDATION_ERROR");
}

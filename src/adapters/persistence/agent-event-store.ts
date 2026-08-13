import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";

import { type Database, getDatabase } from "@/adapters/persistence/db";
import {
  agentEventInbox,
  agentProactiveInsights,
  auditLogs,
} from "@/adapters/persistence/schema";
import type { AgentEventStore } from "@/application/agent-orchestrator/event-service";
import {
  AGENT_PLATFORM_EVENT_TYPES,
  type AgentEventInboxRecord,
  type AgentEventInboxStatus,
  type AgentEventSourceSystem,
  type AgentInsightLevel,
  type AgentInsightStatus,
  type AgentPlatformEventType,
  type AgentProactiveInsightRecord,
} from "@/domain/agent/events";
import { redactSensitiveRecord } from "@/lib/redaction";

export async function createAgentEventStore(): Promise<AgentEventStore> {
  return new PostgresAgentEventStore(await getDatabase({ migrations: "ensure" }));
}

export class PostgresAgentEventStore implements AgentEventStore {
  constructor(private readonly db: Database) {}

  async enqueue(event: AgentEventInboxRecord): Promise<AgentEventInboxRecord> {
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      const [created] = await tx
        .insert(agentEventInbox)
        .values({
          id: event.id,
          tenantId: event.tenantId,
          projectId: event.projectId,
          actorUserId: event.actorSubjectId,
          sourceSystem: event.sourceSystem,
          sourceEventId: event.sourceEventId,
          eventType: event.eventType,
          payload: {
            ...event.payload,
            entityId: event.entityId,
            stateVersion: event.stateVersion,
            occurredAt: event.occurredAt,
          },
          status: event.status,
          attempts: event.attempts,
          maxAttempts: event.maxAttempts,
          availableAt: event.availableAt,
          receivedAt: event.receivedAt,
          correlationId: event.correlationId,
          idempotencyKey: event.idempotencyKey,
          authorizationVersion: event.authorizationVersion,
          roleAssignmentSnapshot: [...event.roleAssignmentSnapshot],
          createdAt: event.receivedAt,
          updatedAt: event.receivedAt,
          retentionUntil: oneCalendarYearAfter(event.receivedAt),
          version: event.version,
        })
        .onConflictDoNothing()
        .returning();
      if (created) {
        await insertAudit(tx, created.actorUserId ?? "demo-service-001", {
          action: "agent.event.received",
          entityType: "AGENT_EVENT",
          entityId: created.id,
          projectId: created.projectId,
          outcome: "SUCCESS",
          requestId: created.correlationId,
          occurredAt: created.receivedAt,
          details: { eventType: created.eventType, sourceSystem: created.sourceSystem },
        });
        return toEvent(created);
      }
      const [existing] = await tx
        .select()
        .from(agentEventInbox)
        .where(
          and(
            eq(agentEventInbox.tenantId, event.tenantId),
            eq(agentEventInbox.sourceSystem, event.sourceSystem),
            eq(agentEventInbox.sourceEventId, event.sourceEventId),
          ),
        )
        .limit(1);
      if (!existing) throw new Error("AGENT_EVENT_IDEMPOTENCY_RACE");
      return toEvent(existing);
    });
  }

  async peekNext(projectId: string): Promise<AgentEventInboxRecord | null> {
    const now = new Date().toISOString();
    const [row] = await this.db
      .select()
      .from(agentEventInbox)
      .where(and(
        eq(agentEventInbox.projectId, projectId),
        inArray(agentEventInbox.status, ["PENDING", "FAILED"]),
        lte(agentEventInbox.availableAt, now),
        sql<boolean>`${agentEventInbox.attempts} < ${agentEventInbox.maxAttempts}`,
      ))
      .orderBy(asc(agentEventInbox.availableAt), asc(agentEventInbox.receivedAt), asc(agentEventInbox.id))
      .limit(1);
    return row ? toEvent(row) : null;
  }

  async claimNext(projectId: string, eventId: string): Promise<AgentEventInboxRecord | null> {
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      const now = new Date().toISOString();
      const conditions = [
        eq(agentEventInbox.id, eventId),
        eq(agentEventInbox.projectId, projectId),
        inArray(agentEventInbox.status, ["PENDING", "FAILED"]),
        lte(agentEventInbox.availableAt, now),
        sql<boolean>`${agentEventInbox.attempts} < ${agentEventInbox.maxAttempts}`,
      ];
      const [candidate] = await tx
        .select()
        .from(agentEventInbox)
        .where(and(...conditions))
        .orderBy(asc(agentEventInbox.availableAt), asc(agentEventInbox.receivedAt), asc(agentEventInbox.id))
        .limit(1);
      if (!candidate) return null;
      const [claimed] = await tx
        .update(agentEventInbox)
        .set({
          status: "PROCESSING",
          attempts: candidate.attempts + 1,
          lockedAt: now,
          safeErrorCode: null,
          updatedAt: now,
          version: candidate.version + 1,
        })
        .where(
          and(
            eq(agentEventInbox.id, candidate.id),
            eq(agentEventInbox.status, candidate.status),
            eq(agentEventInbox.version, candidate.version),
          ),
        )
        .returning();
      return claimed ? toEvent(claimed) : null;
    });
  }

  async completeWithInsight(
    event: AgentEventInboxRecord,
    insight: AgentProactiveInsightRecord,
  ): Promise<AgentProactiveInsightRecord> {
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      const [persistedInsight] = await tx
        .insert(agentProactiveInsights)
        .values(toInsightInsert(insight))
        .onConflictDoUpdate({
          target: [
            agentProactiveInsights.tenantId,
            agentProactiveInsights.projectId,
            agentProactiveInsights.deduplicationKey,
          ],
          set: {
            stateVersion: insight.stateVersion,
            level: insight.level,
            status: "ACTIVE",
            title: insight.title,
            summary: insight.summary,
            recommendedAction: insight.recommendedAction,
            evidenceFactIds: [...insight.evidenceFactIds],
            lastSeenAt: insight.lastSeenAt,
            cooldownUntil: insight.cooldownUntil,
            expiresAt: insight.expiresAt,
            authorizationVersion: insight.authorizationVersion,
            roleAssignmentSnapshot: [...insight.roleAssignmentSnapshot],
            updatedAt: insight.lastSeenAt,
            version: sql`${agentProactiveInsights.version} + 1`,
          },
        })
        .returning();
      if (!persistedInsight) throw new Error("AGENT_INSIGHT_UPSERT_FAILED");
      const [completed] = await tx
        .update(agentEventInbox)
        .set({
          status: "PROCESSED",
          processedAt: insight.lastSeenAt,
          lockedAt: null,
          safeErrorCode: null,
          updatedAt: insight.lastSeenAt,
          version: event.version + 1,
        })
        .where(
          and(
            eq(agentEventInbox.id, event.id),
            eq(agentEventInbox.status, "PROCESSING"),
            eq(agentEventInbox.version, event.version),
          ),
        )
        .returning();
      if (!completed) throw new Error("AGENT_EVENT_OPTIMISTIC_LOCK");
      await insertAudit(tx, event.actorSubjectId ?? "demo-service-001", {
        action: "agent.event.processed",
        entityType: "AGENT_EVENT",
        entityId: event.id,
        projectId: event.projectId,
        outcome: "SUCCESS",
        requestId: event.correlationId,
        occurredAt: insight.lastSeenAt,
        details: {
          eventType: event.eventType,
          insightId: persistedInsight.id,
          attempt: event.attempts,
          ruleVersion: persistedInsight.ruleVersion,
        },
      });
      return toInsight(persistedInsight);
    });
  }

  async fail(event: AgentEventInboxRecord, safeErrorCode: string): Promise<AgentEventInboxRecord> {
    const now = new Date();
    const terminal = event.attempts >= event.maxAttempts;
    const availableAt = new Date(now.getTime() + Math.min(300, 2 ** event.attempts) * 1_000).toISOString();
    const [updated] = await this.db
      .update(agentEventInbox)
      .set({
        status: terminal ? "DEAD_LETTER" : "FAILED",
        availableAt,
        lockedAt: null,
        safeErrorCode: safeCode(safeErrorCode),
        updatedAt: now.toISOString(),
        version: event.version + 1,
      })
      .where(
        and(
          eq(agentEventInbox.id, event.id),
          eq(agentEventInbox.status, "PROCESSING"),
          eq(agentEventInbox.version, event.version),
        ),
      )
      .returning();
    if (!updated) throw new Error("AGENT_EVENT_OPTIMISTIC_LOCK");
    return toEvent(updated);
  }

  async listInsights(
    subjectId: string,
    projectId: string,
  ): Promise<readonly AgentProactiveInsightRecord[]> {
    const rows = await this.db
      .select()
      .from(agentProactiveInsights)
      .where(
        and(
          eq(agentProactiveInsights.projectId, projectId),
          inArray(agentProactiveInsights.status, ["ACTIVE", "ACKNOWLEDGED"]),
          sql<boolean>`(${agentProactiveInsights.subjectUserId} is null or ${agentProactiveInsights.subjectUserId} = ${subjectId})`,
        ),
      )
      .orderBy(asc(agentProactiveInsights.level), asc(agentProactiveInsights.lastSeenAt));
    return rows.map(toInsight);
  }

  async findInsight(
    projectId: string,
    triggerType: string,
    entityId: string,
    stateVersion: string,
  ): Promise<AgentProactiveInsightRecord | null> {
    const [row] = await this.db
      .select()
      .from(agentProactiveInsights)
      .where(and(
        eq(agentProactiveInsights.projectId, projectId),
        eq(agentProactiveInsights.triggerType, triggerType),
        eq(agentProactiveInsights.targetId, entityId),
        eq(agentProactiveInsights.stateVersion, stateVersion),
      ))
      .orderBy(asc(agentProactiveInsights.id))
      .limit(1);
    return row ? toInsight(row) : null;
  }
}

function toEvent(row: typeof agentEventInbox.$inferSelect): AgentEventInboxRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    projectId: row.projectId,
    actorSubjectId: row.actorUserId,
    sourceSystem: sourceSystem(row.sourceSystem),
    sourceEventId: row.sourceEventId,
    eventType: eventType(row.eventType),
    entityId: requiredPayloadString(row.payload, "entityId"),
    stateVersion: requiredPayloadString(row.payload, "stateVersion"),
    occurredAt: requiredPayloadString(row.payload, "occurredAt"),
    payload: payloadWithoutEnvelope(row.payload),
    status: inboxStatus(row.status),
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    availableAt: row.availableAt,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt,
    safeErrorCode: row.safeErrorCode,
    idempotencyKey: row.idempotencyKey,
    correlationId: row.correlationId,
    authorizationVersion: row.authorizationVersion,
    roleAssignmentSnapshot: row.roleAssignmentSnapshot,
    version: row.version,
  };
}

function toInsightInsert(insight: AgentProactiveInsightRecord) {
  return {
    id: insight.id,
    tenantId: insight.tenantId,
    projectId: insight.projectId,
    caseId: insight.caseId,
    subjectUserId: insight.subjectUserId,
    triggerType: insight.triggerType,
    stateVersion: insight.stateVersion,
    level: insight.level,
    status: insight.status,
    targetType: insight.targetType,
    targetId: insight.targetId,
    title: insight.title,
    summary: insight.summary,
    recommendedAction: insight.recommendedAction,
    evidenceFactIds: [...insight.evidenceFactIds],
    deduplicationKey: insight.deduplicationKey,
    ruleVersion: insight.ruleVersion,
    firstSeenAt: insight.firstSeenAt,
    lastSeenAt: insight.lastSeenAt,
    cooldownUntil: insight.cooldownUntil,
    expiresAt: insight.expiresAt,
    authorizationVersion: insight.authorizationVersion,
    roleAssignmentSnapshot: [...insight.roleAssignmentSnapshot],
    createdByUserId: insight.createdBySubjectId,
    createdAt: insight.firstSeenAt,
    updatedAt: insight.lastSeenAt,
    retentionUntil: oneCalendarYearAfter(insight.firstSeenAt),
    version: insight.version,
  } satisfies typeof agentProactiveInsights.$inferInsert;
}

function toInsight(row: typeof agentProactiveInsights.$inferSelect): AgentProactiveInsightRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    projectId: row.projectId,
    caseId: row.caseId,
    subjectUserId: row.subjectUserId,
    triggerType: eventType(row.triggerType),
    stateVersion: row.stateVersion,
    level: insightLevel(row.level),
    status: insightStatus(row.status),
    targetType: row.targetType,
    targetId: row.targetId,
    title: row.title,
    summary: row.summary,
    recommendedAction: row.recommendedAction,
    evidenceFactIds: row.evidenceFactIds,
    deduplicationKey: row.deduplicationKey,
    ruleVersion: row.ruleVersion,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    cooldownUntil: row.cooldownUntil,
    expiresAt: row.expiresAt,
    authorizationVersion: row.authorizationVersion,
    roleAssignmentSnapshot: row.roleAssignmentSnapshot,
    createdBySubjectId: row.createdByUserId,
    version: row.version,
  };
}

async function insertAudit(
  db: Database,
  userId: string,
  input: {
    readonly action: string;
    readonly entityType: string;
    readonly entityId: string;
    readonly projectId: string;
    readonly outcome: string;
    readonly requestId: string;
    readonly occurredAt: string;
    readonly details: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(auditLogs).values({
    id: `audit-${randomUUID()}`,
    userId,
    actorDisplayName: userId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    outcome: input.outcome,
    details: redactSensitiveRecord({ projectId: input.projectId, ...input.details }),
    occurredAt: input.occurredAt,
    retentionUntil: oneCalendarYearAfter(input.occurredAt),
    requestId: input.requestId,
  });
}

function payloadWithoutEnvelope(value: Record<string, unknown>): Record<string, unknown> {
  const envelopeKeys = new Set(["entityId", "stateVersion", "occurredAt"]);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !envelopeKeys.has(key)));
}

function requiredPayloadString(value: Record<string, unknown>, key: string): string {
  const item = value[key];
  if (typeof item !== "string" || !item) throw new Error("AGENT_EVENT_PAYLOAD_INVALID");
  return item;
}

function sourceSystem(value: string): AgentEventSourceSystem {
  if (["APPIUS", "SAP", "PROCESS_ENGINE", "RISK_ENGINE"].includes(value)) return value as AgentEventSourceSystem;
  throw new Error("AGENT_EVENT_SOURCE_INVALID");
}

function eventType(value: string): AgentPlatformEventType {
  if ((AGENT_PLATFORM_EVENT_TYPES as readonly string[]).includes(value)) return value as AgentPlatformEventType;
  throw new Error("AGENT_EVENT_TYPE_INVALID");
}

function inboxStatus(value: string): AgentEventInboxStatus {
  if (["PENDING", "PROCESSING", "PROCESSED", "FAILED", "DEAD_LETTER"].includes(value)) return value as AgentEventInboxStatus;
  throw new Error("AGENT_EVENT_STATUS_INVALID");
}

function insightLevel(value: string): AgentInsightLevel {
  if (["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(value)) return value as AgentInsightLevel;
  throw new Error("AGENT_INSIGHT_LEVEL_INVALID");
}

function insightStatus(value: string): AgentInsightStatus {
  if (["ACTIVE", "ACKNOWLEDGED", "RESOLVED", "EXPIRED", "SUPPRESSED"].includes(value)) return value as AgentInsightStatus;
  throw new Error("AGENT_INSIGHT_STATUS_INVALID");
}

function safeCode(value: string): string {
  return /^[A-Z][A-Z0-9_]{1,99}$/u.test(value) ? value : "AGENT_EVENT_PROCESSING_FAILED";
}

function oneCalendarYearAfter(timestamp: string): string {
  const value = new Date(timestamp);
  if (!Number.isFinite(value.getTime())) throw new Error("AGENT_EVENT_TIMESTAMP_INVALID");
  value.setUTCFullYear(value.getUTCFullYear() + 1);
  return value.toISOString();
}

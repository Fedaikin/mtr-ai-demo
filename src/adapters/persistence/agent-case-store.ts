import "server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import { type Database, getDatabase } from "@/adapters/persistence/db";
import { agentCases, agentEvidenceFacts, auditLogs } from "@/adapters/persistence/schema";
import type { AgentCaseStore } from "@/application/agent-orchestrator/case-service";
import {
  AGENT_CASE_STATUSES,
  type AgentCaseContextSnapshot,
  type AgentCaseRecord,
  type AgentCaseStatus,
  type AgentEvidenceFactRecord,
  type AgentEvidenceFreshness,
} from "@/domain/agent/case";
import {
  AGENT_EVIDENCE_SOURCE_SYSTEMS,
  type AgentEvidenceSourceSystem,
} from "@/domain/agent/evidence";
import { redactSensitiveRecord } from "@/lib/redaction";

export async function createAgentCaseStore(): Promise<AgentCaseStore> {
  return new PostgresAgentCaseStore(await getDatabase({ migrations: "ensure" }));
}

export class PostgresAgentCaseStore implements AgentCaseStore {
  constructor(private readonly db: Database) {}

  async createOrGet(input: AgentCaseRecord, idempotencyKey: string): Promise<AgentCaseRecord> {
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      const [existing] = await tx
        .select()
        .from(agentCases)
        .where(
          and(
            eq(agentCases.id, input.id),
            eq(agentCases.tenantId, input.tenantId),
            eq(agentCases.projectId, input.projectId),
            eq(agentCases.ownerUserId, input.ownerSubjectId),
          ),
        )
        .limit(1);
      if (existing) return toCase(existing);
      const [created] = await tx
        .insert(agentCases)
        .values({
          id: input.id,
          tenantId: input.tenantId,
          projectId: input.projectId,
          ownerUserId: input.ownerSubjectId,
          threadId: input.threadId,
          status: input.status,
          title: input.title,
          contextSnapshot: { ...input.contextSnapshot, idempotencyKey },
          authorizationVersion: input.authorizationVersion,
          roleAssignmentSnapshot: [...input.roleAssignmentSnapshot],
          createdByUserId: input.ownerSubjectId,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
          retentionUntil: oneCalendarYearAfter(input.createdAt),
          version: input.version,
        })
        .returning();
      if (!created) throw new Error("AGENT_CASE_CREATE_FAILED");
      await insertCaseAudit(tx, created, "agent.case.created", input.ownerSubjectId);
      return toCase(created);
    });
  }

  async getOwned(
    id: string,
    subjectId: string,
    projectId: string,
  ): Promise<AgentCaseRecord | null> {
    const [row] = await this.db
      .select()
      .from(agentCases)
      .where(
        and(
          eq(agentCases.id, id),
          eq(agentCases.projectId, projectId),
          eq(agentCases.ownerUserId, subjectId),
        ),
      )
      .limit(1);
    return row ? toCase(row) : null;
  }

  async listOwned(subjectId: string, projectId: string): Promise<readonly AgentCaseRecord[]> {
    const rows = await this.db
      .select()
      .from(agentCases)
      .where(and(eq(agentCases.projectId, projectId), eq(agentCases.ownerUserId, subjectId)))
      .orderBy(desc(agentCases.updatedAt), desc(agentCases.id));
    return rows.map(toCase);
  }

  async appendEvidence(input: AgentEvidenceFactRecord): Promise<AgentEvidenceFactRecord> {
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      const [ownedCase] = await tx
        .select({ id: agentCases.id })
        .from(agentCases)
        .where(
          and(
            eq(agentCases.id, input.caseId),
            eq(agentCases.tenantId, input.tenantId),
            eq(agentCases.projectId, input.projectId),
            eq(agentCases.ownerUserId, input.createdBySubjectId),
          ),
        )
        .limit(1);
      if (!ownedCase) throw new Error("AGENT_CASE_NOT_FOUND");
      const [created] = await tx
        .insert(agentEvidenceFacts)
        .values({
          id: input.id,
          tenantId: input.tenantId,
          projectId: input.projectId,
          caseId: input.caseId,
          kind: input.kind,
          summary: input.summary,
          sourceSystem: input.sourceSystem,
          entityId: input.entityId,
          versionOrSnapshot: input.versionOrSnapshot,
          clauseId: input.clauseId,
          observedAt: input.observedAt,
          sourceSnapshotAt: input.sourceSnapshotAt,
          freshness: input.freshness,
          payload: { ...input.payload },
          accessAttributes: { ...input.accessAttributes },
          fingerprint: input.fingerprint,
          authorizationVersion: input.authorizationVersion,
          roleAssignmentSnapshot: [...input.roleAssignmentSnapshot],
          createdByUserId: input.createdBySubjectId,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
          retentionUntil: oneCalendarYearAfter(input.createdAt),
          version: input.version,
        })
        .onConflictDoNothing()
        .returning();
      if (created) {
        await insertEvidenceAudit(tx, created, "agent.evidence.persisted", input.createdBySubjectId);
        return toEvidence(created);
      }
      const [existing] = await tx
        .select()
        .from(agentEvidenceFacts)
        .where(
          and(
            eq(agentEvidenceFacts.tenantId, input.tenantId),
            eq(agentEvidenceFacts.caseId, input.caseId),
            eq(agentEvidenceFacts.fingerprint, input.fingerprint),
          ),
        )
        .limit(1);
      if (!existing) throw new Error("AGENT_EVIDENCE_IDEMPOTENCY_RACE");
      return toEvidence(existing);
    });
  }

  async listEvidence(
    caseId: string,
    subjectId: string,
    projectId: string,
  ): Promise<readonly AgentEvidenceFactRecord[]> {
    const rows = await this.db
      .select({ fact: agentEvidenceFacts })
      .from(agentEvidenceFacts)
      .innerJoin(
        agentCases,
        and(
          eq(agentCases.id, agentEvidenceFacts.caseId),
          eq(agentCases.tenantId, agentEvidenceFacts.tenantId),
          eq(agentCases.projectId, agentEvidenceFacts.projectId),
          eq(agentCases.ownerUserId, subjectId),
        ),
      )
      .where(
        and(
          eq(agentEvidenceFacts.caseId, caseId),
          eq(agentEvidenceFacts.projectId, projectId),
        ),
      )
      .orderBy(agentEvidenceFacts.createdAt, agentEvidenceFacts.id);
    return rows.map(({ fact }) => toEvidence(fact));
  }

  async updateStatus(
    id: string,
    subjectId: string,
    projectId: string,
    version: number,
    status: AgentCaseStatus,
    updatedAt: string,
  ): Promise<AgentCaseRecord> {
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      const [updated] = await tx
        .update(agentCases)
        .set({ status, updatedAt, version: version + 1 })
        .where(
          and(
            eq(agentCases.id, id),
            eq(agentCases.projectId, projectId),
            eq(agentCases.ownerUserId, subjectId),
            eq(agentCases.version, version),
          ),
        )
        .returning();
      if (!updated) throw new Error("AGENT_CASE_OPTIMISTIC_LOCK");
      await insertCaseAudit(tx, updated, "agent.case.status_changed", subjectId);
      return toCase(updated);
    });
  }
}

function toCase(row: typeof agentCases.$inferSelect): AgentCaseRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    projectId: row.projectId,
    ownerSubjectId: row.ownerUserId,
    threadId: row.threadId,
    status: caseStatus(row.status),
    title: row.title,
    contextSnapshot: contextSnapshot(row.contextSnapshot),
    authorizationVersion: row.authorizationVersion,
    roleAssignmentSnapshot: row.roleAssignmentSnapshot,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function toEvidence(row: typeof agentEvidenceFacts.$inferSelect): AgentEvidenceFactRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    projectId: row.projectId,
    caseId: row.caseId,
    kind: row.kind,
    summary: row.summary,
    sourceSystem: sourceSystem(row.sourceSystem),
    entityId: row.entityId,
    versionOrSnapshot: row.versionOrSnapshot,
    clauseId: row.clauseId,
    observedAt: row.observedAt,
    sourceSnapshotAt: row.sourceSnapshotAt,
    freshness: freshness(row.freshness),
    payload: row.payload,
    accessAttributes: row.accessAttributes,
    fingerprint: row.fingerprint,
    authorizationVersion: row.authorizationVersion,
    roleAssignmentSnapshot: row.roleAssignmentSnapshot,
    createdBySubjectId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

async function insertCaseAudit(
  db: Database,
  row: typeof agentCases.$inferSelect,
  action: string,
  actorId: string,
): Promise<void> {
  await insertAudit(db, {
    actorId,
    action,
    entityType: "AGENT_CASE",
    entityId: row.id,
    projectId: row.projectId,
    details: { status: row.status, authorizationVersion: row.authorizationVersion },
    occurredAt: row.updatedAt,
  });
}

async function insertEvidenceAudit(
  db: Database,
  row: typeof agentEvidenceFacts.$inferSelect,
  action: string,
  actorId: string,
): Promise<void> {
  await insertAudit(db, {
    actorId,
    action,
    entityType: "AGENT_EVIDENCE_FACT",
    entityId: row.id,
    projectId: row.projectId,
    details: {
      caseId: row.caseId,
      sourceSystem: row.sourceSystem,
      freshness: row.freshness,
      authorizationVersion: row.authorizationVersion,
    },
    occurredAt: row.createdAt,
  });
}

async function insertAudit(
  db: Database,
  input: {
    readonly actorId: string;
    readonly action: string;
    readonly entityType: string;
    readonly entityId: string;
    readonly projectId: string;
    readonly details: Record<string, unknown>;
    readonly occurredAt: string;
  },
): Promise<void> {
  await db.insert(auditLogs).values({
    id: `audit-${randomUUID()}`,
    userId: input.actorId,
    actorDisplayName: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    outcome: "SUCCESS",
    details: redactSensitiveRecord({ projectId: input.projectId, ...input.details }),
    occurredAt: input.occurredAt,
    retentionUntil: oneCalendarYearAfter(input.occurredAt),
    requestId: null,
  });
}

function caseStatus(value: string): AgentCaseStatus {
  if ((AGENT_CASE_STATUSES as readonly string[]).includes(value)) return value as AgentCaseStatus;
  throw new Error("AGENT_CASE_STATUS_INVALID");
}

function sourceSystem(value: string): AgentEvidenceSourceSystem {
  if ((AGENT_EVIDENCE_SOURCE_SYSTEMS as readonly string[]).includes(value)) {
    return value as AgentEvidenceSourceSystem;
  }
  throw new Error("AGENT_EVIDENCE_SOURCE_INVALID");
}

function freshness(value: string): AgentEvidenceFreshness {
  if (["FRESH", "AGING", "STALE", "UNKNOWN"].includes(value)) {
    return value as AgentEvidenceFreshness;
  }
  throw new Error("AGENT_EVIDENCE_FRESHNESS_INVALID");
}

function contextSnapshot(value: Record<string, unknown>): AgentCaseContextSnapshot {
  const result: Record<string, unknown> = {};
  for (const key of ["specificationId", "positionId", "runId"] as const) {
    if (typeof value[key] === "string") result[key] = value[key];
  }
  if (value.period && typeof value.period === "object" && !Array.isArray(value.period)) {
    const period = value.period as Record<string, unknown>;
    if (typeof period.from === "string" && typeof period.to === "string") {
      result.period = { from: period.from, to: period.to };
    }
  }
  return result as AgentCaseContextSnapshot;
}

function oneCalendarYearAfter(timestamp: string): string {
  const value = new Date(timestamp);
  if (!Number.isFinite(value.getTime())) throw new Error("AGENT_PERSISTENCE_TIMESTAMP_INVALID");
  value.setUTCFullYear(value.getUTCFullYear() + 1);
  return value.toISOString();
}

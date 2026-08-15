import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import { type Database, getDatabase } from "@/adapters/persistence/db";
import {
  agentCitations,
  agentLearningCandidates,
  agentMessages,
  auditLogs,
} from "@/adapters/persistence/schema";
import {
  type AgentLearningAuditEnvelope,
  AgentLearningError,
  type AgentLearningStore,
  type AgentLearningSubmission,
  type AgentLearningTransition,
} from "@/application/agent-orchestrator/learning-service";
import {
  AGENT_FEEDBACK_KINDS,
  AGENT_LEARNING_CANDIDATE_STATUSES,
  type AgentFeedbackKind,
  type AgentLearningCandidate,
  type AgentLearningCandidateStatus,
} from "@/domain/agent/learning";
import { redactSensitiveRecord } from "@/lib/redaction";

export const DEFAULT_AGENT_LEARNING_TENANT_ID = "demo-tenant-001";

export async function createAgentLearningStore(
  tenantId = DEFAULT_AGENT_LEARNING_TENANT_ID,
): Promise<AgentLearningStore> {
  return new PostgresAgentLearningStore(await getDatabase(), tenantId);
}

export class PostgresAgentLearningStore implements AgentLearningStore {
  constructor(
    private readonly db: Database,
    private readonly tenantId = DEFAULT_AGENT_LEARNING_TENANT_ID,
  ) {}

  async submitWithAudit(
    input: AgentLearningSubmission,
    audit: AgentLearningAuditEnvelope,
  ): Promise<AgentLearningCandidate> {
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      const [existing] = await tx
        .select()
        .from(agentLearningCandidates)
        .where(and(
          eq(agentLearningCandidates.tenantId, this.tenantId),
          eq(agentLearningCandidates.projectId, input.projectId),
          eq(agentLearningCandidates.idempotencyKey, input.idempotencyKey),
        ))
        .limit(1);
      if (existing) return toCandidate(existing);

      const [message] = await tx
        .select()
        .from(agentMessages)
        .where(and(
          eq(agentMessages.id, input.responseMessageId),
          eq(agentMessages.userId, input.ownerUserId),
          eq(agentMessages.role, "assistant"),
        ))
        .limit(1);
      if (!message) throw accessDenied();

      const provenance = learningProvenance(message.structuredOutput);
      if (provenance.projectId !== input.projectId) throw accessDenied();

      const citations = await tx
        .select()
        .from(agentCitations)
        .where(and(
          eq(agentCitations.messageId, message.id),
          eq(agentCitations.userId, input.ownerUserId),
        ));
      const [created] = await tx
        .insert(agentLearningCandidates)
        .values({
          id: input.id,
          tenantId: this.tenantId,
          projectId: input.projectId,
          ownerUserId: input.ownerUserId,
          responseMessageId: input.responseMessageId,
          caseId: provenance.caseId,
          feedbackKind: input.feedbackKind,
          status: "QUARANTINED",
          sanitizedSummary: input.sanitizedSummary,
          sourcePromptVersion: message.promptVersion ?? "unversioned",
          sourceModelVersion: provenance.modelVersion,
          sourceRuleVersions: provenance.ruleVersions,
          sourceEvidenceVersion: provenance.evidenceVersion ?? evidenceFingerprint(citations),
          applicability: null,
          regressionCaseId: null,
          validationChecksum: null,
          validationSummary: null,
          idempotencyKey: input.idempotencyKey,
          authorizationVersion: input.authorizationVersion,
          roleAssignmentSnapshot: [...input.roleAssignmentSnapshot],
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
          retentionUntil: oneCalendarYearAfter(input.createdAt),
          version: 1,
        })
        .onConflictDoNothing()
        .returning();
      if (!created) {
        const [raced] = await tx
          .select()
          .from(agentLearningCandidates)
          .where(and(
            eq(agentLearningCandidates.tenantId, this.tenantId),
            eq(agentLearningCandidates.projectId, input.projectId),
            eq(agentLearningCandidates.ownerUserId, input.ownerUserId),
            eq(agentLearningCandidates.responseMessageId, input.responseMessageId),
          ))
          .limit(1);
        if (!raced) throw conflict();
        return toCandidate(raced);
      }
      await insertAudit(tx, audit, input.createdAt);
      return toCandidate(created);
    });
  }

  async getForProject(id: string, projectId: string): Promise<AgentLearningCandidate | null> {
    const [row] = await this.db
      .select()
      .from(agentLearningCandidates)
      .where(and(
        eq(agentLearningCandidates.id, id),
        eq(agentLearningCandidates.tenantId, this.tenantId),
        eq(agentLearningCandidates.projectId, projectId),
      ))
      .limit(1);
    return row ? toCandidate(row) : null;
  }

  async transitionWithAudit(
    id: string,
    projectId: string,
    version: number,
    transition: AgentLearningTransition,
    audit: AgentLearningAuditEnvelope,
  ): Promise<AgentLearningCandidate> {
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      const [updated] = await tx
        .update(agentLearningCandidates)
        .set({
          status: transition.status,
          authorizationVersion: transition.authorizationVersion,
          roleAssignmentSnapshot: [...transition.roleAssignmentSnapshot],
          updatedAt: transition.updatedAt,
          version: version + 1,
          ...(transition.applicability === undefined
            ? {}
            : { applicability: { ...transition.applicability } }),
          ...(transition.regressionCaseId === undefined
            ? {}
            : { regressionCaseId: transition.regressionCaseId }),
          ...(transition.validationChecksum === undefined
            ? {}
            : { validationChecksum: transition.validationChecksum }),
          ...(transition.validationSummary === undefined && transition.reason === undefined
            ? {}
            : { validationSummary: transition.validationSummary ?? transition.reason ?? null }),
          ...(transition.status === "APPROVED"
            ? { approvedByUserId: transition.actorId, approvedAt: transition.updatedAt }
            : {}),
          ...(transition.status === "PROMOTED"
            ? { promotedByUserId: transition.actorId, promotedAt: transition.updatedAt }
            : {}),
          ...(transition.status === "REJECTED"
            ? { rejectedByUserId: transition.actorId, rejectedAt: transition.updatedAt }
            : {}),
          ...(transition.status === "REVOKED"
            ? { revokedByUserId: transition.actorId, revokedAt: transition.updatedAt }
            : {}),
        })
        .where(and(
          eq(agentLearningCandidates.id, id),
          eq(agentLearningCandidates.tenantId, this.tenantId),
          eq(agentLearningCandidates.projectId, projectId),
          eq(agentLearningCandidates.version, version),
          inArray(agentLearningCandidates.status, [...transition.expectedStatuses]),
        ))
        .returning();
      if (!updated) throw conflict();
      await insertAudit(tx, audit, transition.updatedAt);
      return toCandidate(updated);
    });
  }
}

function toCandidate(
  row: typeof agentLearningCandidates.$inferSelect,
): AgentLearningCandidate {
  return {
    id: row.id,
    projectId: row.projectId,
    ownerUserId: row.ownerUserId,
    responseMessageId: row.responseMessageId,
    caseId: row.caseId,
    feedbackKind: feedbackKind(row.feedbackKind),
    status: candidateStatus(row.status),
    sanitizedSummary: row.sanitizedSummary,
    sourcePromptVersion: row.sourcePromptVersion,
    sourceModelVersion: row.sourceModelVersion,
    sourceRuleVersions: Object.freeze([...row.sourceRuleVersions]),
    sourceEvidenceVersion: row.sourceEvidenceVersion,
    applicability: row.applicability ? Object.freeze({ ...row.applicability }) : null,
    regressionCaseId: row.regressionCaseId,
    validationChecksum: row.validationChecksum,
    validationSummary: row.validationSummary,
    idempotencyKey: row.idempotencyKey,
    authorizationVersion: row.authorizationVersion,
    roleAssignmentSnapshot: Object.freeze([...row.roleAssignmentSnapshot]),
    approvedByUserId: row.approvedByUserId,
    promotedByUserId: row.promotedByUserId,
    rejectedByUserId: row.rejectedByUserId,
    revokedByUserId: row.revokedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    approvedAt: row.approvedAt,
    promotedAt: row.promotedAt,
    rejectedAt: row.rejectedAt,
    revokedAt: row.revokedAt,
    version: row.version,
  };
}

async function insertAudit(
  db: Database,
  audit: AgentLearningAuditEnvelope,
  occurredAt: string,
): Promise<void> {
  await db.insert(auditLogs).values({
    id: `audit-${randomUUID()}`,
    userId: audit.actorId,
    actorDisplayName: audit.actorId,
    action: audit.action,
    entityType: "AGENT_LEARNING_CANDIDATE",
    entityId: audit.candidateId,
    outcome: audit.outcome,
    details: redactSensitiveRecord({
      projectId: audit.projectId,
      feedbackKind: audit.feedbackKind,
      authorizationVersion: audit.authorizationVersion,
      roleAssignmentSnapshot: audit.roleAssignmentSnapshot,
      lifecyclePolicy: "quarantine-human-approval-v1",
    }),
    occurredAt,
    retentionUntil: oneCalendarYearAfter(occurredAt),
    requestId: audit.requestId,
  });
}

function learningProvenance(value: Record<string, unknown> | null): {
  readonly projectId: string | null;
  readonly caseId: string | null;
  readonly modelVersion: string;
  readonly ruleVersions: string[];
  readonly evidenceVersion: string | null;
} {
  const record = asRecord(value?.learningProvenance);
  return {
    projectId: safeId(record?.projectId),
    caseId: safeId(record?.caseId),
    modelVersion: safeVersion(record?.modelVersion) ?? "deterministic-runtime-v1",
    ruleVersions: Array.isArray(record?.ruleVersions)
      ? record.ruleVersions.flatMap((item) => safeVersion(item) ? [String(item)] : []).slice(0, 20)
      : [],
    evidenceVersion: safeVersion(record?.evidenceVersion),
  };
}

function evidenceFingerprint(citations: readonly (typeof agentCitations.$inferSelect)[]): string {
  const canonical = citations
    .map((citation) => [
      citation.sourceSystem,
      citation.entityId,
      citation.versionOrSnapshot,
      citation.clauseId ?? "",
    ].join("\u001f"))
    .sort()
    .join("\u001e");
  return createHash("sha256").update(canonical || "no-authorized-citations").digest("hex");
}

function feedbackKind(value: string): AgentFeedbackKind {
  if ((AGENT_FEEDBACK_KINDS as readonly string[]).includes(value)) return value as AgentFeedbackKind;
  throw new Error("AGENT_FEEDBACK_KIND_INVALID");
}

function candidateStatus(value: string): AgentLearningCandidateStatus {
  if ((AGENT_LEARNING_CANDIDATE_STATUSES as readonly string[]).includes(value)) {
    return value as AgentLearningCandidateStatus;
  }
  throw new Error("AGENT_LEARNING_STATUS_INVALID");
}

function safeId(value: unknown): string | null {
  return typeof value === "string" && value.trim() && value.length <= 200 ? value.trim() : null;
}

function safeVersion(value: unknown): string | null {
  return typeof value === "string" && value.trim() && value.length <= 200 ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function oneCalendarYearAfter(timestamp: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error("AGENT_LEARNING_TIMESTAMP_INVALID");
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString();
}

function accessDenied(): AgentLearningError {
  return new AgentLearningError("AGENT_FEEDBACK_ACCESS_DENIED", "Отзыв недоступен");
}

function conflict(): AgentLearningError {
  return new AgentLearningError("AGENT_LEARNING_CONFLICT", "Кандидат уже изменён");
}

import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { type Database, getDatabase } from "@/adapters/persistence/db";
import { agentActionProposals, auditLogs } from "@/adapters/persistence/schema";
import type {
  AgentActionAuditEnvelope,
  AgentActionStore,
} from "@/application/agent-orchestrator/action-service";
import {
  AGENT_ACTION_TYPES,
  type ActionExecutionResult,
  type AgentActionProposal,
  type AgentActionStatus,
  type AgentActionType,
} from "@/domain/agent/actions";
import { PERMISSION_KEYS, type PermissionKey } from "@/domain/rbac";
import { redactSensitiveRecord } from "@/lib/redaction";

export const DEFAULT_AGENT_TENANT_ID = "demo-tenant-001";

export async function createAgentActionStore(
  tenantId = DEFAULT_AGENT_TENANT_ID,
): Promise<AgentActionStore> {
  return new PostgresAgentActionStore(await getDatabase({ migrations: "ensure" }), tenantId);
}

export class PostgresAgentActionStore implements AgentActionStore {
  constructor(
    private readonly db: Database,
    private readonly tenantId = DEFAULT_AGENT_TENANT_ID,
  ) {}

  async createOrGetWithAudit(
    proposal: AgentActionProposal,
    audit: AgentActionAuditEnvelope,
  ): Promise<AgentActionProposal> {
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      const [existing] = await tx
        .select()
        .from(agentActionProposals)
        .where(
          and(
            eq(agentActionProposals.tenantId, this.tenantId),
            eq(agentActionProposals.projectId, proposal.projectId),
            eq(agentActionProposals.idempotencyKey, proposal.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) return toProposal(existing);

      const [created] = await tx
        .insert(agentActionProposals)
        .values(toInsert(this.tenantId, proposal))
        .onConflictDoNothing()
        .returning();
      if (!created) {
        const [raced] = await tx
          .select()
          .from(agentActionProposals)
          .where(
            and(
              eq(agentActionProposals.tenantId, this.tenantId),
              eq(agentActionProposals.projectId, proposal.projectId),
              eq(agentActionProposals.idempotencyKey, proposal.idempotencyKey),
            ),
          )
          .limit(1);
        if (!raced) throw new Error("AGENT_ACTION_IDEMPOTENCY_RACE");
        return toProposal(raced);
      }
      await insertAudit(tx, audit, proposal.proposedBy, proposal.createdAt);
      return toProposal(created);
    });
  }

  async getAuthorized(
    id: string,
    subjectId: string,
    projectId: string,
  ): Promise<AgentActionProposal | null> {
    const [row] = await this.db
      .select()
      .from(agentActionProposals)
      .where(
        and(
          eq(agentActionProposals.id, id),
          eq(agentActionProposals.tenantId, this.tenantId),
          eq(agentActionProposals.projectId, projectId),
          eq(agentActionProposals.proposedByUserId, subjectId),
        ),
      )
      .limit(1);
    return row ? toProposal(row) : null;
  }

  async claimForExecution(
    id: string,
    version: number,
    updatedAt: string,
    audit: AgentActionAuditEnvelope,
  ): Promise<
    | { readonly outcome: "CLAIMED"; readonly proposal: AgentActionProposal }
    | { readonly outcome: "EXISTING"; readonly proposal: AgentActionProposal }
  > {
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      const [claimed] = await tx
        .update(agentActionProposals)
        .set({
          status: "EXECUTING",
          confirmationAuthorizationVersion: audit.authorizationVersion,
          confirmationRoleAssignmentSnapshot: [...audit.roleAssignmentSnapshot],
          confirmedAt: updatedAt,
          executionStartedAt: updatedAt,
          updatedAt,
          version: version + 1,
        })
        .where(
          and(
            eq(agentActionProposals.id, id),
            eq(agentActionProposals.tenantId, this.tenantId),
            eq(agentActionProposals.projectId, audit.projectId),
            eq(agentActionProposals.proposedByUserId, audit.actorId),
            eq(agentActionProposals.status, "PROPOSED"),
            eq(agentActionProposals.version, version),
          ),
        )
        .returning();
      if (claimed) {
        await insertAudit(tx, audit, audit.actorId, updatedAt);
        return { outcome: "CLAIMED", proposal: toProposal(claimed) };
      }
      const [existing] = await tx
        .select()
        .from(agentActionProposals)
        .where(
          and(
            eq(agentActionProposals.id, id),
            eq(agentActionProposals.tenantId, this.tenantId),
            eq(agentActionProposals.projectId, audit.projectId),
            eq(agentActionProposals.proposedByUserId, audit.actorId),
          ),
        )
        .limit(1);
      if (!existing) throw new Error("AGENT_ACTION_NOT_FOUND");
      return { outcome: "EXISTING", proposal: toProposal(existing) };
    });
  }

  async completeWithAudit(
    id: string,
    version: number,
    result: ActionExecutionResult | null,
    updatedAt: string,
    audit: AgentActionAuditEnvelope,
  ): Promise<AgentActionProposal> {
    return this.transitionWithAudit(id, version, "SUCCEEDED", result, null, updatedAt, audit);
  }

  async failWithAudit(
    id: string,
    version: number,
    errorCode: string,
    updatedAt: string,
    audit: AgentActionAuditEnvelope,
  ): Promise<AgentActionProposal> {
    return this.transitionWithAudit(id, version, "FAILED", null, errorCode, updatedAt, audit);
  }

  async cancelWithAudit(
    id: string,
    version: number,
    updatedAt: string,
    audit: AgentActionAuditEnvelope,
  ): Promise<AgentActionProposal> {
    return this.transitionWithAudit(id, version, "CANCELLED", null, null, updatedAt, audit);
  }

  private async transitionWithAudit(
    id: string,
    version: number,
    status: Extract<AgentActionStatus, "SUCCEEDED" | "FAILED" | "CANCELLED">,
    result: ActionExecutionResult | null,
    errorCode: string | null,
    updatedAt: string,
    audit: AgentActionAuditEnvelope,
  ): Promise<AgentActionProposal> {
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      const expectedStatus = status === "CANCELLED" ? "PROPOSED" : "EXECUTING";
      const [updated] = await tx
        .update(agentActionProposals)
        .set({
          status,
          result: result ? { ...result } : null,
          safeErrorCode: errorCode,
          ...(status === "CANCELLED" ? { cancelledAt: updatedAt } : { completedAt: updatedAt }),
          updatedAt,
          version: version + 1,
        })
        .where(
          and(
            eq(agentActionProposals.id, id),
            eq(agentActionProposals.tenantId, this.tenantId),
            eq(agentActionProposals.projectId, audit.projectId),
            eq(agentActionProposals.proposedByUserId, audit.actorId),
            eq(agentActionProposals.status, expectedStatus),
            eq(agentActionProposals.version, version),
          ),
        )
        .returning();
      if (!updated) throw new Error("AGENT_ACTION_OPTIMISTIC_LOCK");
      await insertAudit(tx, audit, audit.actorId, updatedAt);
      return toProposal(updated);
    });
  }
}

function toInsert(tenantId: string, proposal: AgentActionProposal) {
  return {
    id: proposal.id,
    tenantId,
    projectId: proposal.projectId,
    caseId: proposal.caseId,
    planExecutionId: null,
    proposedByUserId: proposal.proposedBy,
    actionType: proposal.actionType,
    status: proposal.status,
    resourceDescriptor: { ...proposal.resource },
    requiredPermission: proposal.requiredPermission,
    summary: proposal.summary,
    consequences: [...proposal.consequences],
    parameters: { ...proposal.parameters },
    result: proposal.result ? { ...proposal.result } : null,
    idempotencyKey: proposal.idempotencyKey,
    authorizationVersion: proposal.authorizationVersion,
    roleAssignmentSnapshot: [...proposal.roleAssignmentSnapshot],
    proposedAt: proposal.createdAt,
    expiresAt: proposal.expiresAt,
    correlationId: proposal.correlationId,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
    retentionUntil: oneCalendarYearAfter(proposal.createdAt),
    version: proposal.version,
  } satisfies typeof agentActionProposals.$inferInsert;
}

function toProposal(row: typeof agentActionProposals.$inferSelect): AgentActionProposal {
  return {
    id: row.id,
    caseId: row.caseId,
    actionType: actionType(row.actionType),
    projectId: row.projectId,
    resource: resourceDescriptor(row.resourceDescriptor),
    requiredPermission: permission(row.requiredPermission),
    summary: row.summary,
    consequences: row.consequences,
    parameters: row.parameters,
    status: actionStatus(row.status),
    idempotencyKey: row.idempotencyKey,
    proposedBy: row.proposedByUserId,
    roleAssignmentSnapshot: row.roleAssignmentSnapshot,
    authorizationVersion: row.authorizationVersion,
    correlationId: row.correlationId,
    createdAt: row.proposedAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
    version: row.version,
    result: actionResult(row.result),
    errorCode: row.safeErrorCode,
  };
}

async function insertAudit(
  db: Database,
  audit: AgentActionAuditEnvelope,
  userId: string,
  occurredAt: string,
): Promise<void> {
  await db.insert(auditLogs).values({
    id: `audit-${randomUUID()}`,
    userId,
    actorDisplayName: userId,
    action: audit.action,
    entityType: "AGENT_ACTION_PROPOSAL",
    entityId: audit.actionProposalId,
    outcome: audit.outcome,
    details: redactSensitiveRecord({
      projectId: audit.projectId,
      actionType: audit.actionType,
      permission: audit.permission,
      authorizationVersion: audit.authorizationVersion,
      roleAssignmentSnapshot: audit.roleAssignmentSnapshot,
      ...(audit.errorCode ? { errorCode: audit.errorCode } : {}),
    }),
    occurredAt,
    retentionUntil: oneCalendarYearAfter(occurredAt),
    requestId: audit.requestId,
  });
}

function actionType(value: string): AgentActionType {
  if ((AGENT_ACTION_TYPES as readonly string[]).includes(value)) return value as AgentActionType;
  throw new Error("AGENT_ACTION_TYPE_INVALID");
}

function actionStatus(value: string): AgentActionStatus {
  if (["PROPOSED", "EXECUTING", "SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"].includes(value)) {
    return value as AgentActionStatus;
  }
  throw new Error("AGENT_ACTION_STATUS_INVALID");
}

function permission(value: string): PermissionKey {
  if ((PERMISSION_KEYS as readonly string[]).includes(value)) return value as PermissionKey;
  throw new Error("AGENT_ACTION_PERMISSION_INVALID");
}

function resourceDescriptor(value: Record<string, unknown>): AgentActionProposal["resource"] {
  if (typeof value.resourceType !== "string" || typeof value.resourceId !== "string") {
    throw new Error("AGENT_ACTION_RESOURCE_INVALID");
  }
  return value as unknown as AgentActionProposal["resource"];
}

function actionResult(value: Record<string, unknown> | null): ActionExecutionResult | null {
  if (!value) return null;
  if (
    typeof value.resourceType !== "string" ||
    typeof value.resourceId !== "string" ||
    (value.status !== "ACCEPTED" && value.status !== "COMPLETED") ||
    typeof value.safeSummary !== "string" ||
    !(typeof value.link === "string" || value.link === null)
  ) {
    throw new Error("AGENT_ACTION_RESULT_INVALID");
  }
  return value as unknown as ActionExecutionResult;
}

function oneCalendarYearAfter(timestamp: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error("AGENT_ACTION_TIMESTAMP_INVALID");
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString();
}

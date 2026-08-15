import "server-only";

import { createHash } from "node:crypto";

import {
  requirePermission,
  type ResourceDescriptor,
  type TrustedRequestContext,
} from "@/application/authorization-service";
import {
  AGENT_FEEDBACK_KINDS,
  type AgentFeedbackKind,
  type AgentLearningCandidate,
  type AgentLearningCandidateStatus,
  type PublicAgentFeedbackReceipt,
  toPublicAgentFeedbackReceipt,
} from "@/domain/agent/learning";
import { redactSensitiveRecord } from "@/lib/redaction";

export interface SubmitAgentFeedbackInput {
  readonly responseMessageId: string;
  readonly feedbackKind: AgentFeedbackKind;
  readonly summary?: string;
}

export interface ApproveLearningCandidateInput {
  readonly applicability: Readonly<Record<string, unknown>>;
  readonly regressionCaseId: string;
  readonly validationChecksum: string;
  readonly validationSummary: string;
}

export interface AgentLearningAuditEnvelope {
  readonly action:
    | "agent.feedback.submitted"
    | "agent.learning.approved"
    | "agent.learning.promoted"
    | "agent.learning.rejected"
    | "agent.learning.revoked";
  readonly actorId: string;
  readonly projectId: string;
  readonly candidateId: string;
  readonly feedbackKind: AgentFeedbackKind;
  readonly authorizationVersion: number;
  readonly roleAssignmentSnapshot: readonly string[];
  readonly requestId: string;
  readonly outcome: "SUCCESS";
}

export interface AgentLearningSubmission {
  readonly id: string;
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly responseMessageId: string;
  readonly feedbackKind: AgentFeedbackKind;
  readonly sanitizedSummary: string | null;
  readonly idempotencyKey: string;
  readonly authorizationVersion: number;
  readonly roleAssignmentSnapshot: readonly string[];
  readonly createdAt: string;
}

export interface AgentLearningTransition {
  readonly expectedStatuses: readonly AgentLearningCandidateStatus[];
  readonly status: AgentLearningCandidateStatus;
  readonly actorId: string;
  readonly authorizationVersion: number;
  readonly roleAssignmentSnapshot: readonly string[];
  readonly updatedAt: string;
  readonly applicability?: Readonly<Record<string, unknown>>;
  readonly regressionCaseId?: string;
  readonly validationChecksum?: string;
  readonly validationSummary?: string;
  readonly reason?: string;
}

export interface AgentLearningStore {
  submitWithAudit(
    input: AgentLearningSubmission,
    audit: AgentLearningAuditEnvelope,
  ): Promise<AgentLearningCandidate>;
  getForProject(id: string, projectId: string): Promise<AgentLearningCandidate | null>;
  transitionWithAudit(
    id: string,
    projectId: string,
    version: number,
    transition: AgentLearningTransition,
    audit: AgentLearningAuditEnvelope,
  ): Promise<AgentLearningCandidate>;
}

export class AgentFeedbackService {
  constructor(
    private readonly store: AgentLearningStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async submit(
    input: SubmitAgentFeedbackInput,
    context: TrustedRequestContext,
  ): Promise<PublicAgentFeedbackReceipt> {
    const projectId = requireActiveProject(context);
    validateFeedback(input);
    requirePermission(context, "agent.chat", {
      resourceType: "AGENT_MESSAGE",
      resourceId: input.responseMessageId,
      projectId,
      ownerUserId: context.subjectId,
    });
    const idempotencyKey = sha256([
      context.subjectId,
      projectId,
      input.responseMessageId.trim(),
    ].join("\u001f"));
    const submission: AgentLearningSubmission = {
      id: `learning-${idempotencyKey.slice(0, 24)}`,
      projectId,
      ownerUserId: context.subjectId,
      responseMessageId: input.responseMessageId.trim(),
      feedbackKind: input.feedbackKind,
      sanitizedSummary: sanitizeSummary(input.summary),
      idempotencyKey,
      authorizationVersion: context.authorizationVersion,
      roleAssignmentSnapshot: Object.freeze([...context.activeRoleAssignmentIds]),
      createdAt: this.now().toISOString(),
    };
    const candidate = await this.store.submitWithAudit(
      submission,
      auditEnvelope(submission, context, "agent.feedback.submitted"),
    );
    return toPublicAgentFeedbackReceipt(candidate);
  }
}

export class AgentLearningCurationService {
  constructor(
    private readonly store: AgentLearningStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async approve(
    id: string,
    input: ApproveLearningCandidateInput,
    context: TrustedRequestContext,
  ): Promise<AgentLearningCandidate> {
    const candidate = await this.requireCandidate(id, context, "review.decide");
    validateApproval(input);
    return this.transition(candidate, context, {
      expectedStatuses: ["QUARANTINED"],
      status: "APPROVED",
      applicability: redactSensitiveRecord({ ...input.applicability }),
      regressionCaseId: input.regressionCaseId.trim(),
      validationChecksum: input.validationChecksum.toLowerCase(),
      validationSummary: sanitizedRequired(input.validationSummary, 500),
    }, "agent.learning.approved");
  }

  async promote(id: string, context: TrustedRequestContext): Promise<AgentLearningCandidate> {
    const candidate = await this.requireCandidate(id, context, "prompt.activate");
    if (
      candidate.status !== "APPROVED" ||
      !candidate.regressionCaseId ||
      !candidate.validationChecksum ||
      !candidate.applicability
    ) {
      throw invalidState();
    }
    return this.transition(candidate, context, {
      expectedStatuses: ["APPROVED"],
      status: "PROMOTED",
    }, "agent.learning.promoted");
  }

  async reject(
    id: string,
    reason: string,
    context: TrustedRequestContext,
  ): Promise<AgentLearningCandidate> {
    const candidate = await this.requireCandidate(id, context, "review.decide");
    return this.transition(candidate, context, {
      expectedStatuses: ["QUARANTINED", "APPROVED"],
      status: "REJECTED",
      reason: sanitizedRequired(reason, 500),
    }, "agent.learning.rejected");
  }

  async revoke(
    id: string,
    reason: string,
    context: TrustedRequestContext,
  ): Promise<AgentLearningCandidate> {
    const candidate = await this.requireCandidate(id, context, "prompt.activate");
    return this.transition(candidate, context, {
      expectedStatuses: ["PROMOTED"],
      status: "REVOKED",
      reason: sanitizedRequired(reason, 500),
    }, "agent.learning.revoked");
  }

  private async requireCandidate(
    id: string,
    context: TrustedRequestContext,
    permission: "review.decide" | "prompt.activate",
  ): Promise<AgentLearningCandidate> {
    const projectId = requireActiveProject(context);
    if (!id.trim() || id.length > 200) throw validation();
    requirePermission(context, permission, candidateResource(id, projectId));
    const candidate = await this.store.getForProject(id, projectId);
    if (!candidate) throw denied();
    return candidate;
  }

  private transition(
    candidate: AgentLearningCandidate,
    context: TrustedRequestContext,
    input: Omit<AgentLearningTransition, "actorId" | "authorizationVersion" | "roleAssignmentSnapshot" | "updatedAt">,
    action: AgentLearningAuditEnvelope["action"],
  ): Promise<AgentLearningCandidate> {
    const transition: AgentLearningTransition = {
      ...input,
      actorId: context.subjectId,
      authorizationVersion: context.authorizationVersion,
      roleAssignmentSnapshot: Object.freeze([...context.activeRoleAssignmentIds]),
      updatedAt: this.now().toISOString(),
    };
    return this.store.transitionWithAudit(
      candidate.id,
      candidate.projectId,
      candidate.version,
      transition,
      auditEnvelope(candidate, context, action),
    );
  }
}

export type AgentLearningErrorCode =
  | "AGENT_FEEDBACK_VALIDATION_ERROR"
  | "AGENT_FEEDBACK_ACCESS_DENIED"
  | "AGENT_LEARNING_INVALID_STATE"
  | "AGENT_LEARNING_CONFLICT";

export class AgentLearningError extends Error {
  constructor(readonly code: AgentLearningErrorCode, message: string) {
    super(message);
    this.name = "AgentLearningError";
  }
}

function validateFeedback(input: SubmitAgentFeedbackInput): void {
  if (!input.responseMessageId.trim() || input.responseMessageId.length > 200) throw validation();
  if (!AGENT_FEEDBACK_KINDS.includes(input.feedbackKind)) throw validation();
  if (input.summary !== undefined && input.summary.length > 500) throw validation();
}

function validateApproval(input: ApproveLearningCandidateInput): void {
  if (Object.keys(input.applicability).length === 0) throw validation();
  if (!input.regressionCaseId.trim() || input.regressionCaseId.length > 200) throw validation();
  if (!/^[a-f0-9]{64}$/iu.test(input.validationChecksum)) throw validation();
  sanitizedRequired(input.validationSummary, 500);
}

function sanitizeSummary(value: string | undefined): string | null {
  if (value === undefined || !value.trim()) return null;
  return sanitizedRequired(value, 500);
}

function sanitizedRequired(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) throw validation();
  const redacted = redactSensitiveRecord({ summary: trimmed }, { maxStringLength: maxLength });
  return typeof redacted.summary === "string" ? redacted.summary : "[СКРЫТО]";
}

function requireActiveProject(context: TrustedRequestContext): string {
  if (!context.activeProjectId) throw denied();
  return context.activeProjectId;
}

function candidateResource(id: string, projectId: string): ResourceDescriptor {
  return { resourceType: "AGENT_LEARNING_CANDIDATE", resourceId: id, projectId };
}

function auditEnvelope(
  candidate: Pick<AgentLearningSubmission, "id" | "projectId" | "feedbackKind"> | AgentLearningCandidate,
  context: TrustedRequestContext,
  action: AgentLearningAuditEnvelope["action"],
): AgentLearningAuditEnvelope {
  return {
    action,
    actorId: context.subjectId,
    projectId: candidate.projectId,
    candidateId: candidate.id,
    feedbackKind: candidate.feedbackKind,
    authorizationVersion: context.authorizationVersion,
    roleAssignmentSnapshot: Object.freeze([...context.activeRoleAssignmentIds]),
    requestId: context.requestId,
    outcome: "SUCCESS",
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validation(): AgentLearningError {
  return new AgentLearningError("AGENT_FEEDBACK_VALIDATION_ERROR", "Проверьте отзыв");
}

function denied(): AgentLearningError {
  return new AgentLearningError("AGENT_FEEDBACK_ACCESS_DENIED", "Отзыв недоступен");
}

function invalidState(): AgentLearningError {
  return new AgentLearningError(
    "AGENT_LEARNING_INVALID_STATE",
    "Кандидат нельзя перевести в выбранное состояние",
  );
}

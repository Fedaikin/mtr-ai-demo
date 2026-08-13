import "server-only";

import { createHash } from "node:crypto";

import {
  requirePermission,
  type ResourceDescriptor,
  type TrustedRequestContext,
} from "@/application/authorization-service";
import {
  AGENT_ACTION_REQUIRED_PERMISSION,
  AGENT_ACTION_TYPES,
  toPublicAgentActionProposal,
  type ActionExecutionResult,
  type AgentActionProposal,
  type AgentActionType,
  type PublicAgentActionProposal,
} from "@/domain/agent/actions";

const DEFAULT_EXPIRY_MINUTES = 30;

export interface ProposeAgentActionInput {
  readonly caseId: string;
  readonly actionType: AgentActionType;
  readonly resource: ResourceDescriptor;
  readonly summary: string;
  readonly consequences: readonly string[];
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly requestKey: string;
}

export interface AgentActionAuditEnvelope {
  readonly action: "agent.action.proposed" | "agent.action.confirmed" | "agent.action.completed" | "agent.action.failed" | "agent.action.cancelled";
  readonly actorId: string;
  readonly projectId: string;
  readonly actionProposalId: string;
  readonly actionType: AgentActionType;
  readonly permission: string;
  readonly authorizationVersion: number;
  readonly roleAssignmentSnapshot: readonly string[];
  readonly requestId: string;
  readonly outcome: "SUCCESS" | "FAILURE";
  readonly errorCode?: string;
}

export interface AgentActionStore {
  createOrGetWithAudit(
    proposal: AgentActionProposal,
    audit: AgentActionAuditEnvelope,
  ): Promise<AgentActionProposal>;
  getAuthorized(id: string, subjectId: string, projectId: string): Promise<AgentActionProposal | null>;
  claimForExecution(id: string, version: number, updatedAt: string, audit: AgentActionAuditEnvelope): Promise<
    | { readonly outcome: "CLAIMED"; readonly proposal: AgentActionProposal }
    | { readonly outcome: "EXISTING"; readonly proposal: AgentActionProposal }
  >;
  completeWithAudit(id: string, version: number, result: ActionExecutionResult | null, updatedAt: string, audit: AgentActionAuditEnvelope): Promise<AgentActionProposal>;
  failWithAudit(id: string, version: number, errorCode: string, updatedAt: string, audit: AgentActionAuditEnvelope): Promise<AgentActionProposal>;
  cancelWithAudit(id: string, version: number, updatedAt: string, audit: AgentActionAuditEnvelope): Promise<AgentActionProposal>;
}

export interface AgentActionExecutor {
  resolveCurrent(proposal: AgentActionProposal, context: TrustedRequestContext): Promise<ResourceDescriptor | null>;
  execute(proposal: AgentActionProposal, context: TrustedRequestContext): Promise<ActionExecutionResult>;
}

export class AgentActionService {
  constructor(
    private readonly store: AgentActionStore,
    private readonly executor: AgentActionExecutor,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async propose(input: ProposeAgentActionInput, context: TrustedRequestContext): Promise<AgentActionProposal> {
    validateProposalInput(input);
    const projectId = requireActiveProject(context);
    if (input.resource.projectId !== projectId) throw denied();
    const permission = AGENT_ACTION_REQUIRED_PERMISSION[input.actionType];
    requirePermission(context, permission, input.resource);
    const timestamp = this.now().toISOString();
    const idempotencyKey = actionIdempotencyKey(context, input);
    const proposal: AgentActionProposal = {
      id: `action-${idempotencyKey.slice(0, 24)}`,
      caseId: input.caseId.trim(),
      actionType: input.actionType,
      projectId,
      resource: input.resource,
      requiredPermission: permission,
      summary: input.summary.trim(),
      consequences: input.consequences.map((item) => item.trim()),
      parameters: sanitizeParameters(input.parameters),
      status: "PROPOSED",
      idempotencyKey,
      proposedBy: context.subjectId,
      roleAssignmentSnapshot: Object.freeze([...context.activeRoleAssignmentIds]),
      authorizationVersion: context.authorizationVersion,
      correlationId: context.requestId,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: new Date(Date.parse(timestamp) + DEFAULT_EXPIRY_MINUTES * 60_000).toISOString(),
      version: 1,
      result: null,
      errorCode: null,
    };
    return this.store.createOrGetWithAudit(proposal, auditEnvelope(proposal, context, "agent.action.proposed", "SUCCESS"));
  }

  async confirm(id: string, context: TrustedRequestContext): Promise<PublicAgentActionProposal> {
    const proposal = await this.getAuthorized(id, context);
    if (proposal.status === "SUCCEEDED" || proposal.status === "EXECUTING") return toPublicAgentActionProposal(proposal);
    if (proposal.status !== "PROPOSED") throw invalidState();
    if (Date.parse(proposal.expiresAt) <= this.now().getTime()) throw new AgentActionError("ACTION_EXPIRED", "Срок подтверждения действия истёк");
    if (context.authorizationVersion !== proposal.authorizationVersion) throw new AgentActionError("ACTION_AUTHORIZATION_CHANGED", "Права изменились после создания предложения");
    requirePermission(context, proposal.requiredPermission, proposal.resource);
    const current = await this.executor.resolveCurrent(proposal, context);
    if (!current || !sameResource(proposal.resource, current)) throw new AgentActionError("ACTION_RESOURCE_CHANGED", "Состояние объекта изменилось");
    const claim = await this.store.claimForExecution(
      proposal.id,
      proposal.version,
      this.now().toISOString(),
      auditEnvelope(proposal, context, "agent.action.confirmed", "SUCCESS"),
    );
    if (claim.outcome !== "CLAIMED") return toPublicAgentActionProposal(claim.proposal);

    try {
      const result = await this.executor.execute(claim.proposal, context);
      const completed = await this.store.completeWithAudit(
        claim.proposal.id,
        claim.proposal.version,
        result,
        this.now().toISOString(),
        auditEnvelope(claim.proposal, context, "agent.action.completed", "SUCCESS"),
      );
      return toPublicAgentActionProposal(completed);
    } catch (error) {
      const errorCode = error instanceof AgentActionError ? error.code : "ACTION_EXECUTION_FAILED";
      await this.store.failWithAudit(
        claim.proposal.id,
        claim.proposal.version,
        errorCode,
        this.now().toISOString(),
        auditEnvelope(claim.proposal, context, "agent.action.failed", "FAILURE", errorCode),
      );
      throw new AgentActionError("ACTION_EXECUTION_FAILED", "Не удалось выполнить подтверждённое действие");
    }
  }

  async cancel(id: string, context: TrustedRequestContext): Promise<PublicAgentActionProposal> {
    const proposal = await this.getAuthorized(id, context);
    if (proposal.status === "CANCELLED") return toPublicAgentActionProposal(proposal);
    if (proposal.status !== "PROPOSED") throw invalidState();
    if (context.authorizationVersion !== proposal.authorizationVersion) throw new AgentActionError("ACTION_AUTHORIZATION_CHANGED", "Права изменились после создания предложения");
    requirePermission(context, proposal.requiredPermission, proposal.resource);
    return toPublicAgentActionProposal(await this.store.cancelWithAudit(
      proposal.id,
      proposal.version,
      this.now().toISOString(),
      auditEnvelope(proposal, context, "agent.action.cancelled", "SUCCESS"),
    ));
  }

  async get(id: string, context: TrustedRequestContext): Promise<PublicAgentActionProposal> {
    return toPublicAgentActionProposal(await this.getAuthorized(id, context));
  }

  private async getAuthorized(id: string, context: TrustedRequestContext): Promise<AgentActionProposal> {
    const projectId = requireActiveProject(context);
    const proposal = await this.store.getAuthorized(id, context.subjectId, projectId);
    if (!proposal) throw denied();
    return proposal;
  }
}

export type AgentActionErrorCode = "ACTION_VALIDATION_ERROR" | "ACTION_ACCESS_DENIED" | "ACTION_AUTHORIZATION_CHANGED" | "ACTION_RESOURCE_CHANGED" | "ACTION_EXPIRED" | "ACTION_INVALID_STATE" | "ACTION_EXECUTION_FAILED";

export class AgentActionError extends Error {
  constructor(readonly code: AgentActionErrorCode, message: string) {
    super(message);
    this.name = "AgentActionError";
  }
}

function validateProposalInput(input: ProposeAgentActionInput): void {
  if (!AGENT_ACTION_TYPES.includes(input.actionType)) throw validation();
  if (!input.requestKey.trim() || input.requestKey.length > 200) throw validation();
  if (!input.caseId.trim() || input.caseId.length > 200) throw validation();
  if (!input.summary.trim() || input.summary.length > 300) throw validation();
  if (input.consequences.length === 0 || input.consequences.length > 8) throw validation();
  if (input.consequences.some((item) => !item.trim() || item.length > 300)) throw validation();
}

function sanitizeParameters(parameters: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parameters)) {
    if (/^(?:userId|subjectId|role|roles|permissions|authorizationVersion)$/u.test(key) || /password|secret|token|cookie/iu.test(key)) continue;
    safe[key] = value;
  }
  return Object.freeze(safe);
}

function actionIdempotencyKey(context: TrustedRequestContext, input: ProposeAgentActionInput): string {
  return createHash("sha256").update([
    context.subjectId,
    context.activeProjectId ?? "",
    input.actionType,
    input.caseId.trim(),
    input.resource.resourceType,
    input.resource.resourceId,
    input.requestKey.trim(),
    stableJson(sanitizeParameters(input.parameters)),
  ].join("\u001f")).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function auditEnvelope(proposal: AgentActionProposal, context: TrustedRequestContext, action: AgentActionAuditEnvelope["action"], outcome: AgentActionAuditEnvelope["outcome"], errorCode?: string): AgentActionAuditEnvelope {
  return { action, actorId: context.subjectId, projectId: proposal.projectId, actionProposalId: proposal.id, actionType: proposal.actionType, permission: proposal.requiredPermission, authorizationVersion: context.authorizationVersion, roleAssignmentSnapshot: [...context.activeRoleAssignmentIds], requestId: context.requestId, outcome, ...(errorCode ? { errorCode } : {}) };
}

function requireActiveProject(context: TrustedRequestContext): string {
  if (!context.activeProjectId) throw denied();
  return context.activeProjectId;
}

function sameResource(expected: ResourceDescriptor, current: ResourceDescriptor): boolean {
  return expected.resourceType === current.resourceType && expected.resourceId === current.resourceId && expected.projectId === current.projectId && expected.status === current.status;
}

function denied(): AgentActionError { return new AgentActionError("ACTION_ACCESS_DENIED", "Действие недоступно"); }
function validation(): AgentActionError { return new AgentActionError("ACTION_VALIDATION_ERROR", "Проверьте параметры действия"); }
function invalidState(): AgentActionError { return new AgentActionError("ACTION_INVALID_STATE", "Действие нельзя выполнить в текущем состоянии"); }

import type { ResourceDescriptor } from "@/application/authorization-service";
import type { PermissionKey } from "@/domain/rbac";

export const AGENT_ACTION_TYPES = [
  "RUN_SCENARIO",
  "RETRY_SCENARIO",
  "CREATE_REVIEW_TASK",
  "PREPARE_REPORT_DRAFT",
  "PREPARE_EXPORT_DRAFT",
] as const;

export type AgentActionType = (typeof AGENT_ACTION_TYPES)[number];
export type AgentActionStatus = "PROPOSED" | "EXECUTING" | "SUCCEEDED" | "FAILED" | "EXPIRED" | "CANCELLED";

export const AGENT_ACTION_REQUIRED_PERMISSION: Readonly<Record<AgentActionType, PermissionKey>> = {
  RUN_SCENARIO: "analysis.create",
  RETRY_SCENARIO: "analysis.retry.own",
  CREATE_REVIEW_TASK: "review.assign",
  PREPARE_REPORT_DRAFT: "report.read",
  PREPARE_EXPORT_DRAFT: "report.export",
};

export interface ActionExecutionResult {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly status: "ACCEPTED" | "COMPLETED";
  readonly safeSummary: string;
  readonly link: string | null;
}

export interface AgentActionProposal {
  readonly id: string;
  readonly actionType: AgentActionType;
  readonly projectId: string;
  readonly resource: ResourceDescriptor;
  readonly requiredPermission: PermissionKey;
  readonly summary: string;
  readonly consequences: readonly string[];
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly status: AgentActionStatus;
  readonly idempotencyKey: string;
  readonly proposedBy: string;
  readonly roleAssignmentSnapshot: readonly string[];
  readonly authorizationVersion: number;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
  readonly version: number;
  readonly result: ActionExecutionResult | null;
  readonly errorCode: string | null;
}

export interface PublicAgentActionProposal {
  readonly id: string;
  readonly actionType: AgentActionType;
  readonly summary: string;
  readonly consequences: readonly string[];
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly status: AgentActionStatus;
  readonly expiresAt: string;
  readonly result: ActionExecutionResult | null;
}

export function toPublicAgentActionProposal(proposal: AgentActionProposal): PublicAgentActionProposal {
  return {
    id: proposal.id,
    actionType: proposal.actionType,
    summary: proposal.summary,
    consequences: proposal.consequences,
    parameters: proposal.parameters,
    status: proposal.status,
    expiresAt: proposal.expiresAt,
    result: proposal.result,
  };
}

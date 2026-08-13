import type { ResourceDescriptor } from "@/application/authorization-service";
import type { PermissionKey } from "@/domain/rbac";

export const PROJECT_AGENT_ACTION_TYPES = [
  "RUN_SCENARIO",
  "RETRY_SCENARIO",
  "CREATE_REVIEW_TASK",
  "PREPARE_REPORT_DRAFT",
  "PREPARE_EXPORT_DRAFT",
] as const;

export const AGENT_ACTION_TYPES = [
  ...PROJECT_AGENT_ACTION_TYPES,
  "SET_USER_STATUS",
  "SET_PROJECT_MEMBERSHIP_STATUS",
  "ASSIGN_PROJECT_ROLE",
  "ASSIGN_GLOBAL_ROLE",
  "REVOKE_ROLE_ASSIGNMENT",
  "CHANGE_PROJECT_ROLE",
  "SET_ROLE_STATUS",
] as const;

export type AgentActionType = (typeof AGENT_ACTION_TYPES)[number];
export type AgentActionStatus = "PROPOSED" | "EXECUTING" | "SUCCEEDED" | "FAILED" | "EXPIRED" | "CANCELLED";

export const AGENT_ACTION_REQUIRED_PERMISSION: Readonly<Record<AgentActionType, PermissionKey>> = {
  RUN_SCENARIO: "analysis.create",
  RETRY_SCENARIO: "analysis.retry.own",
  CREATE_REVIEW_TASK: "review.assign",
  PREPARE_REPORT_DRAFT: "report.read",
  PREPARE_EXPORT_DRAFT: "report.export",
  SET_USER_STATUS: "user.manage",
  SET_PROJECT_MEMBERSHIP_STATUS: "project.members.manage",
  ASSIGN_PROJECT_ROLE: "project.members.manage",
  ASSIGN_GLOBAL_ROLE: "global_role.manage",
  REVOKE_ROLE_ASSIGNMENT: "global_role.manage",
  CHANGE_PROJECT_ROLE: "project.members.manage",
  SET_ROLE_STATUS: "global_role.manage",
};

export const PRIVILEGED_AGENT_ACTION_TYPES = [
  "SET_USER_STATUS",
  "SET_PROJECT_MEMBERSHIP_STATUS",
  "ASSIGN_PROJECT_ROLE",
  "ASSIGN_GLOBAL_ROLE",
  "REVOKE_ROLE_ASSIGNMENT",
  "CHANGE_PROJECT_ROLE",
  "SET_ROLE_STATUS",
] as const satisfies readonly AgentActionType[];

export type PrivilegedAgentActionType = (typeof PRIVILEGED_AGENT_ACTION_TYPES)[number];

export interface AgentActionImpactPreview {
  readonly targetDisplayName: string;
  readonly targetLogin: string | null;
  readonly currentStatus: string;
  readonly currentRoles: readonly string[];
  readonly projectLabel: string | null;
  readonly newState: string;
  readonly affectedSessions: number;
  readonly affectedAssignments: number;
  readonly segregationOfDuties: "PASS" | "BLOCKED";
  readonly lastAdministratorRisk: boolean;
  readonly lastProjectManagerRisk: boolean;
}

export interface ActionExecutionResult {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly status: "ACCEPTED" | "COMPLETED";
  readonly safeSummary: string;
  readonly link: string | null;
}

export interface AgentActionProposal {
  readonly id: string;
  readonly caseId: string;
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
    parameters: publicParameters(proposal),
    status: proposal.status,
    expiresAt: proposal.expiresAt,
    result: proposal.result,
  };
}

function publicParameters(proposal: AgentActionProposal): Readonly<Record<string, unknown>> {
  if (!(PRIVILEGED_AGENT_ACTION_TYPES as readonly string[]).includes(proposal.actionType)) {
    return proposal.parameters;
  }
  const impact = proposal.parameters.impact;
  if (!impact || typeof impact !== "object" || Array.isArray(impact)) return {};
  const record = impact as Record<string, unknown>;
  return {
    impact: {
      targetDisplayName: text(record.targetDisplayName),
      targetLogin: nullableText(record.targetLogin),
      currentStatus: text(record.currentStatus),
      currentRoles: stringArray(record.currentRoles),
      projectLabel: nullableText(record.projectLabel),
      newState: text(record.newState),
      affectedSessions: nonNegativeInteger(record.affectedSessions),
      affectedAssignments: nonNegativeInteger(record.affectedAssignments),
      segregationOfDuties: record.segregationOfDuties === "PASS" ? "PASS" : "BLOCKED",
      lastAdministratorRisk: record.lastAdministratorRisk === true,
      lastProjectManagerRisk: record.lastProjectManagerRisk === true,
    } satisfies AgentActionImpactPreview,
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 300) : "";
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value.slice(0, 300) : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, 20).map((item) => item.slice(0, 200))
    : [];
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

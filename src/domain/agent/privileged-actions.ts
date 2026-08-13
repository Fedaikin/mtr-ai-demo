import { z } from "zod";

import { ROLE_LABELS, type RoleKey } from "@/domain/rbac";

const projectRoleSchema = z.enum(["PROJECT_VIEWER", "MTR_ANALYST", "MTR_EXPERT", "PROJECT_MANAGER"]);
const globalRoleSchema = z.enum(["SYSTEM_ADMIN", "AUDITOR"]);

export const agentActionImpactPreviewSchema = z.object({
  targetDisplayName: z.string().trim().min(1).max(300),
  targetLogin: z.string().trim().min(1).max(200).nullable(),
  currentStatus: z.string().trim().min(1).max(120),
  currentRoles: z.array(z.string().trim().min(1).max(200)).max(20),
  projectLabel: z.string().trim().min(1).max(300).nullable(),
  newState: z.string().trim().min(1).max(300),
  affectedSessions: z.number().int().nonnegative(),
  affectedAssignments: z.number().int().nonnegative(),
  segregationOfDuties: z.enum(["PASS", "BLOCKED"]),
  lastAdministratorRisk: z.boolean(),
  lastProjectManagerRisk: z.boolean(),
}).strict();

export const privilegedActionParametersSchema = z.discriminatedUnion("actionType", [
  z.object({
    actionType: z.literal("SET_USER_STATUS"),
    targetUserId: z.string().trim().min(1).max(200),
    status: z.enum(["ACTIVE", "BLOCKED"]),
  }).strict(),
  z.object({
    actionType: z.literal("SET_PROJECT_MEMBERSHIP_STATUS"),
    targetUserId: z.string().trim().min(1).max(200),
    projectId: z.string().trim().min(1).max(200),
    status: z.enum(["ACTIVE", "SUSPENDED"]),
  }).strict(),
  z.object({
    actionType: z.literal("ASSIGN_PROJECT_ROLE"),
    targetUserId: z.string().trim().min(1).max(200),
    projectId: z.string().trim().min(1).max(200),
    roleKey: projectRoleSchema,
    validUntil: z.string().datetime().nullable().optional(),
  }).strict(),
  z.object({
    actionType: z.literal("ASSIGN_GLOBAL_ROLE"),
    targetUserId: z.string().trim().min(1).max(200),
    roleKey: globalRoleSchema,
    validUntil: z.string().datetime().nullable().optional(),
  }).strict(),
  z.object({
    actionType: z.literal("REVOKE_ROLE_ASSIGNMENT"),
    targetUserId: z.string().trim().min(1).max(200),
    assignmentId: z.string().trim().min(1).max(200),
    roleKey: z.enum(["SYSTEM_ADMIN", "AUDITOR", "PROJECT_VIEWER", "MTR_ANALYST", "MTR_EXPERT", "PROJECT_MANAGER"]),
    projectId: z.string().trim().min(1).max(200).nullable(),
  }).strict(),
  z.object({
    actionType: z.literal("CHANGE_PROJECT_ROLE"),
    targetUserId: z.string().trim().min(1).max(200),
    projectId: z.string().trim().min(1).max(200),
    currentAssignmentId: z.string().trim().min(1).max(200),
    fromRoleKey: projectRoleSchema,
    toRoleKey: projectRoleSchema,
  }).strict(),
  z.object({
    actionType: z.literal("SET_ROLE_STATUS"),
    roleKey: projectRoleSchema,
    active: z.boolean(),
    approvedReassignmentPlan: z.literal(false).default(false),
  }).strict(),
]);

export type PrivilegedActionParameters = z.infer<typeof privilegedActionParametersSchema>;

export function roleLabel(roleKey: RoleKey): string {
  return ROLE_LABELS[roleKey];
}

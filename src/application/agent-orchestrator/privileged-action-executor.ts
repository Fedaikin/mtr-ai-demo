import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

import { getDatabase } from "@/adapters/persistence/db";
import {
  assignRole,
  changeProjectRole,
  revokeAssignment,
  setProjectMembership,
  setRoleStatus,
  setUserStatus,
} from "@/application/access-administration";
import {
  requirePermission,
  type ResourceDescriptor,
  type TrustedRequestContext,
} from "@/application/authorization-service";
import type { ActionExecutionResult, AgentActionImpactPreview } from "@/domain/agent/actions";
import {
  privilegedActionParametersSchema,
  roleLabel,
  type PrivilegedActionParameters,
} from "@/domain/agent/privileged-actions";
import { hasRoleConflict, type PermissionKey, type RoleKey } from "@/domain/rbac";

export async function resolvePrivilegedActionResource(
  parameters: PrivilegedActionParameters,
  context: TrustedRequestContext,
): Promise<ResourceDescriptor | null> {
  const permission = privilegedActionPermission(parameters);
  requirePermission(context, permission);
  if (!context.activeProjectId) return null;
  const db = await getDatabase({ migrations: "skip" });
  if (parameters.actionType === "SET_ROLE_STATUS") {
    const [role] = rows(await db.execute(sql`
      select r.id, r.key, r.active, r.scope_type,
        (select count(*)::int from role_assignments ra where ra.role_id=r.id and ra.status='ACTIVE') as active_assignments
      from roles r where r.key=${parameters.roleKey} limit 1
    `));
    if (!role || role.scope_type !== "PROJECT") return null;
    return {
      resourceType: "ROLE_DEFINITION",
      resourceId: String(role.id),
      projectId: context.activeProjectId,
      status: fingerprint([String(role.active), String(role.active_assignments ?? 0)]),
    };
  }
  const targetUserId = parameters.targetUserId;
  const [user] = rows(await db.execute(sql`
    select id, status, account_type, authorization_version from users where id=${targetUserId} limit 1
  `));
  if (!user || user.account_type === "SERVICE_ACCOUNT") return null;
  if (isProjectAction(parameters)) {
    const [membership] = rows(await db.execute(sql`
      select status from project_memberships
      where project_id=${parameters.projectId} and user_id=${targetUserId} limit 1
    `));
    if (!membership) return null;
  }
  const assignments = rows(await db.execute(sql`
    select ra.id, ra.status, ra.project_id, r.key
    from role_assignments ra join roles r on r.id=ra.role_id
    where ra.user_id=${targetUserId} order by ra.id
  `));
  return {
    resourceType: parameters.actionType === "SET_PROJECT_MEMBERSHIP_STATUS"
      ? "PROJECT_MEMBERSHIP"
      : parameters.actionType === "REVOKE_ROLE_ASSIGNMENT" || parameters.actionType === "CHANGE_PROJECT_ROLE"
        ? "ROLE_ASSIGNMENT"
        : "USER_ACCESS",
    resourceId: parameters.actionType === "REVOKE_ROLE_ASSIGNMENT"
      ? parameters.assignmentId
      : parameters.actionType === "CHANGE_PROJECT_ROLE"
        ? parameters.currentAssignmentId
        : targetUserId,
    projectId: context.activeProjectId,
    // Access administration is deliberately not an owner-scoped operation:
    // the authenticated administrator acts on another user's access record.
    // Permission + project/resource fingerprint checks are the authority here.
    status: fingerprint([
      String(user.status),
      String(user.authorization_version),
      ...assignments.map((item) => [item.id, item.status, item.project_id ?? "", item.key].join(":")),
    ]),
  };
}

export async function buildPrivilegedActionImpact(
  parameters: PrivilegedActionParameters,
  context: TrustedRequestContext,
): Promise<AgentActionImpactPreview> {
  const permission = privilegedActionPermission(parameters);
  requirePermission(context, permission);
  if (!context.activeProjectId) throw new Error("AGENT_ACTION_PROJECT_REQUIRED");
  const db = await getDatabase({ migrations: "skip" });
  const [project] = rows(await db.execute(sql`
    select id, name from projects where id=${context.activeProjectId} and status='ACTIVE' limit 1
  `));
  if (!project) throw new Error("AGENT_ACTION_PROJECT_NOT_FOUND");

  if (parameters.actionType === "SET_ROLE_STATUS") {
    const [role] = rows(await db.execute(sql`
      select id, key, name_ru, active, scope_type,
        (select count(*)::int from role_assignments ra where ra.role_id=roles.id and ra.status='ACTIVE') as active_assignments
      from roles where key=${parameters.roleKey} limit 1
    `));
    if (!role || role.scope_type !== "PROJECT") throw new Error("AGENT_ACTION_ROLE_NOT_FOUND");
    return {
      targetDisplayName: String(role.name_ru),
      targetLogin: null,
      currentStatus: role.active ? "Активна" : "Неактивна",
      currentRoles: [],
      projectLabel: String(project.name),
      newState: parameters.active ? "Активировать роль" : "Деактивировать роль",
      affectedSessions: 0,
      affectedAssignments: Number(role.active_assignments ?? 0),
      segregationOfDuties: "PASS",
      lastAdministratorRisk: false,
      lastProjectManagerRisk: false,
    };
  }

  const [user] = rows(await db.execute(sql`
    select id, login, display_name, status, account_type from users where id=${parameters.targetUserId} limit 1
  `));
  if (!user || user.account_type === "SERVICE_ACCOUNT") throw new Error("AGENT_ACTION_TARGET_NOT_FOUND");
  const assignments = rows(await db.execute(sql`
    select ra.id, ra.project_id, ra.status, r.key, r.name_ru
    from role_assignments ra join roles r on r.id=ra.role_id
    where ra.user_id=${parameters.targetUserId} and ra.status='ACTIVE' order by r.key
  `));
  const [sessions] = rows(await db.execute(sql`
    select count(*)::int as count from auth_sessions
    where user_id=${parameters.targetUserId} and revoked_at is null and expires_at>now()
  `));
  const currentRoleKeys = assignments.map((item) => String(item.key) as RoleKey);
  const prospectiveRoles = prospectiveRoleKeys(parameters, currentRoleKeys);
  const lastAdministratorRisk = await isLastRoleHolder(db, "SYSTEM_ADMIN", parameters.targetUserId) && removesRole(parameters, "SYSTEM_ADMIN");
  const lastProjectManagerRisk = await isLastProjectManager(
    db,
    context.activeProjectId,
    parameters.targetUserId,
  ) && removesRole(parameters, "PROJECT_MANAGER");
  return {
    targetDisplayName: String(user.display_name),
    targetLogin: String(user.login),
    currentStatus: String(user.status) === "ACTIVE" ? "Активен" : "Заблокирован",
    currentRoles: assignments.map((item) => `${String(item.name_ru)}${item.project_id ? ` · ${String(project.name)}` : " · глобально"}`),
    projectLabel: String(project.name),
    newState: newStateLabel(parameters),
    affectedSessions: Number(sessions?.count ?? 0),
    affectedAssignments: affectedAssignmentCount(parameters, assignments),
    segregationOfDuties: hasRoleConflict(prospectiveRoles) ? "BLOCKED" : "PASS",
    lastAdministratorRisk,
    lastProjectManagerRisk,
  };
}

export async function executePrivilegedAction(
  parameters: PrivilegedActionParameters,
  context: TrustedRequestContext,
): Promise<ActionExecutionResult> {
  requirePermission(context, privilegedActionPermission(parameters));
  switch (parameters.actionType) {
    case "SET_USER_STATUS":
      await setUserStatus(context.subjectId, parameters.targetUserId, parameters.status);
      return completed("USER_ACCESS", parameters.targetUserId, parameters.status === "ACTIVE" ? "Пользователь активирован" : "Пользователь заблокирован", "/admin/users");
    case "SET_PROJECT_MEMBERSHIP_STATUS":
      await setProjectMembership({
        actorId: context.subjectId,
        projectId: parameters.projectId,
        userId: parameters.targetUserId,
        status: parameters.status,
      });
      return completed("PROJECT_MEMBERSHIP", parameters.targetUserId, parameters.status === "ACTIVE" ? "Доступ к проекту активирован" : "Доступ к проекту приостановлен", `/projects/${encodeURIComponent(parameters.projectId)}/members`);
    case "ASSIGN_PROJECT_ROLE":
      await assignRole({ actorId: context.subjectId, userId: parameters.targetUserId, roleKey: parameters.roleKey, projectId: parameters.projectId, validUntil: parameters.validUntil });
      return completed("ROLE_ASSIGNMENT", parameters.targetUserId, `Назначена роль «${roleLabel(parameters.roleKey)}»`, `/projects/${encodeURIComponent(parameters.projectId)}/members`);
    case "ASSIGN_GLOBAL_ROLE":
      await assignRole({ actorId: context.subjectId, userId: parameters.targetUserId, roleKey: parameters.roleKey, validUntil: parameters.validUntil });
      return completed("ROLE_ASSIGNMENT", parameters.targetUserId, `Назначена роль «${roleLabel(parameters.roleKey)}»`, "/admin/users");
    case "REVOKE_ROLE_ASSIGNMENT":
      await revokeAssignment(context.subjectId, parameters.assignmentId);
      return completed("ROLE_ASSIGNMENT", parameters.assignmentId, `Роль «${roleLabel(parameters.roleKey)}» отозвана`, parameters.projectId ? `/projects/${encodeURIComponent(parameters.projectId)}/members` : "/admin/users");
    case "CHANGE_PROJECT_ROLE":
      await changeProjectRole({
        actorId: context.subjectId,
        userId: parameters.targetUserId,
        projectId: parameters.projectId,
        currentAssignmentId: parameters.currentAssignmentId,
        fromRoleKey: parameters.fromRoleKey,
        toRoleKey: parameters.toRoleKey,
      });
      return completed("ROLE_ASSIGNMENT", parameters.targetUserId, `Роль изменена на «${roleLabel(parameters.toRoleKey)}»`, `/projects/${encodeURIComponent(parameters.projectId)}/members`);
    case "SET_ROLE_STATUS":
      await setRoleStatus({ actorId: context.subjectId, roleKey: parameters.roleKey, active: parameters.active, approvedReassignmentPlan: parameters.approvedReassignmentPlan });
      return completed("ROLE_DEFINITION", parameters.roleKey, parameters.active ? "Роль активирована" : "Роль деактивирована", "/admin/roles");
  }
}

export function privilegedActionPermission(parameters: PrivilegedActionParameters): PermissionKey {
  if (
    parameters.actionType === "SET_PROJECT_MEMBERSHIP_STATUS" ||
    parameters.actionType === "ASSIGN_PROJECT_ROLE" ||
    parameters.actionType === "CHANGE_PROJECT_ROLE" ||
    parameters.actionType === "REVOKE_ROLE_ASSIGNMENT" && parameters.projectId !== null
  ) return "project.members.manage";
  if (parameters.actionType === "SET_USER_STATUS") return "user.manage";
  return "global_role.manage";
}

export function parseStoredPrivilegedParameters(
  actionType: string,
  parameters: Readonly<Record<string, unknown>>,
): PrivilegedActionParameters {
  const stored = { ...parameters };
  delete stored.impact;
  return privilegedActionParametersSchema.parse({ actionType, ...stored });
}

function isProjectAction(parameters: PrivilegedActionParameters): parameters is Extract<PrivilegedActionParameters, { projectId: string }> {
  return "projectId" in parameters && typeof parameters.projectId === "string";
}

function prospectiveRoleKeys(parameters: PrivilegedActionParameters, current: readonly RoleKey[]): RoleKey[] {
  if (parameters.actionType === "ASSIGN_PROJECT_ROLE" || parameters.actionType === "ASSIGN_GLOBAL_ROLE") {
    return [...current, parameters.roleKey];
  }
  if (parameters.actionType === "CHANGE_PROJECT_ROLE") {
    return [...current.filter((role) => role !== parameters.fromRoleKey), parameters.toRoleKey];
  }
  if (parameters.actionType === "REVOKE_ROLE_ASSIGNMENT") {
    return current.filter((role) => role !== parameters.roleKey);
  }
  return [...current];
}

function removesRole(parameters: PrivilegedActionParameters, role: RoleKey): boolean {
  if (parameters.actionType === "SET_USER_STATUS") return parameters.status === "BLOCKED";
  if (parameters.actionType === "REVOKE_ROLE_ASSIGNMENT") return parameters.roleKey === role;
  if (parameters.actionType === "CHANGE_PROJECT_ROLE") return parameters.fromRoleKey === role;
  if (parameters.actionType === "SET_PROJECT_MEMBERSHIP_STATUS") return parameters.status === "SUSPENDED" && role === "PROJECT_MANAGER";
  return false;
}

async function isLastRoleHolder(db: Awaited<ReturnType<typeof getDatabase>>, roleKey: RoleKey, userId: string): Promise<boolean> {
  const [row] = rows(await db.execute(sql`
    select count(distinct ra.user_id)::int as count,
      bool_or(ra.user_id=${userId}) as target_has_role
    from role_assignments ra join roles r on r.id=ra.role_id join users u on u.id=ra.user_id
    where r.key=${roleKey} and ra.status='ACTIVE' and u.status='ACTIVE'
  `));
  return row?.target_has_role === true && Number(row.count ?? 0) <= 1;
}

async function isLastProjectManager(db: Awaited<ReturnType<typeof getDatabase>>, projectId: string, userId: string): Promise<boolean> {
  const [row] = rows(await db.execute(sql`
    select count(distinct ra.user_id)::int as count,
      bool_or(ra.user_id=${userId}) as target_has_role
    from role_assignments ra join roles r on r.id=ra.role_id
    join project_memberships pm on pm.project_id=ra.project_id and pm.user_id=ra.user_id
    join users u on u.id=ra.user_id
    where ra.project_id=${projectId} and r.key='PROJECT_MANAGER'
      and ra.status='ACTIVE' and pm.status='ACTIVE' and u.status='ACTIVE'
  `));
  return row?.target_has_role === true && Number(row.count ?? 0) <= 1;
}

function affectedAssignmentCount(parameters: PrivilegedActionParameters, assignments: Array<Record<string, unknown>>): number {
  if (parameters.actionType === "SET_USER_STATUS" && parameters.status === "BLOCKED") return assignments.length;
  if (parameters.actionType === "SET_PROJECT_MEMBERSHIP_STATUS" && parameters.status === "SUSPENDED") {
    return assignments.filter((item) => item.project_id === parameters.projectId).length;
  }
  if (parameters.actionType === "SET_ROLE_STATUS") return 0;
  return 1;
}

function newStateLabel(parameters: PrivilegedActionParameters): string {
  switch (parameters.actionType) {
    case "SET_USER_STATUS": return parameters.status === "ACTIVE" ? "Активировать пользователя" : "Заблокировать пользователя";
    case "SET_PROJECT_MEMBERSHIP_STATUS": return parameters.status === "ACTIVE" ? "Активировать доступ к проекту" : "Приостановить доступ к проекту";
    case "ASSIGN_PROJECT_ROLE":
    case "ASSIGN_GLOBAL_ROLE": return `Назначить роль «${roleLabel(parameters.roleKey)}»`;
    case "REVOKE_ROLE_ASSIGNMENT": return `Отозвать роль «${roleLabel(parameters.roleKey)}»`;
    case "CHANGE_PROJECT_ROLE": return `Сменить роль «${roleLabel(parameters.fromRoleKey)}» на «${roleLabel(parameters.toRoleKey)}»`;
    case "SET_ROLE_STATUS": return parameters.active ? "Активировать роль" : "Деактивировать роль";
  }
}

function completed(resourceType: string, resourceId: string, safeSummary: string, link: string): ActionExecutionResult {
  return { resourceType, resourceId, status: "COMPLETED", safeSummary, link };
}

function fingerprint(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex");
}

function rows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) {
    return result.rows as Array<Record<string, unknown>>;
  }
  return [];
}

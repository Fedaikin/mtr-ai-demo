import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import { getDatabase } from "@/adapters/persistence/db";
import { expandRolePermissions, type PermissionKey, type RoleKey } from "@/domain/rbac";

export interface TrustedRequestContext {
  subjectId: string;
  displayName: string;
  activeRoleAssignmentIds: readonly string[];
  globalRoleKeys: readonly RoleKey[];
  activeProjectId: string | null;
  projectRoleKeys: readonly RoleKey[];
  permissionKeys: ReadonlySet<PermissionKey>;
  catalogScopeIds: readonly string[];
  sourceScopeIds: readonly string[];
  accessClaims: Readonly<Record<string, readonly string[]>>;
  authorizationVersion: number;
  requestId: string;
}

export interface ResourceDescriptor {
  resourceType: string;
  resourceId: string;
  projectId?: string;
  ownerUserId?: string;
  status?: string;
  accessAttributes?: Record<string, unknown>;
}

export class AuthorizationError extends Error {
  constructor(readonly permission: PermissionKey, message = "Недостаточно прав для выполнения операции") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export async function resolveAuthorizationContext(subjectId: string, requestedProjectId?: string | null): Promise<TrustedRequestContext> {
  const database = await getDatabase();
  const userRows = rows(await database.execute(sql`select id, display_name, status, account_type, authorization_version from users where id = ${subjectId} limit 1`));
  const user = userRows[0];
  if (!user || user.status !== "ACTIVE") throw new AuthorizationError("profile.read.own", "Учётная запись заблокирована");
  if (user.account_type === "SERVICE_ACCOUNT") throw new AuthorizationError("profile.read.own", "Интерактивный вход сервисной учётной записи запрещён");

  const memberships = rows(await database.execute(sql`
    select project_id from project_memberships
    where user_id = ${subjectId} and status = 'ACTIVE' and valid_from <= now() and (valid_until is null or valid_until > now())
    order by created_at
  `));
  const allowedProjectIds = memberships.map((row) => String(row.project_id));
  const activeProjectId = requestedProjectId && allowedProjectIds.includes(requestedProjectId)
    ? requestedProjectId
    : allowedProjectIds[0] ?? null;

  const assignments = rows(await database.execute(sql`
    select ra.id, ra.scope_type, ra.project_id, r.key as role_key
    from role_assignments ra join roles r on r.id = ra.role_id
    where ra.user_id = ${subjectId} and ra.status = 'ACTIVE' and r.active = true
      and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now())
      and (ra.scope_type = 'GLOBAL' or (ra.scope_type = 'PROJECT' and ra.project_id = ${activeProjectId}))
  `));
  const globalRoleKeys = assignments.filter((row) => row.scope_type === "GLOBAL").map((row) => String(row.role_key) as RoleKey);
  const projectRoleKeys = assignments.filter((row) => row.scope_type === "PROJECT").map((row) => String(row.role_key) as RoleKey);
  const permissionKeys = expandRolePermissions([...globalRoleKeys, ...projectRoleKeys]);
  const claimRows = rows(await database.execute(sql`select claim_type, claim_value from user_source_access_claims where user_id = ${subjectId} and (valid_until is null or valid_until > now())`));
  const accessClaims: Record<string, string[]> = {};
  for (const claim of claimRows) (accessClaims[String(claim.claim_type)] ??= []).push(String(claim.claim_value));

  return {
    subjectId,
    displayName: String(user.display_name),
    activeRoleAssignmentIds: assignments.map((row) => String(row.id)),
    globalRoleKeys,
    activeProjectId,
    projectRoleKeys,
    permissionKeys,
    catalogScopeIds: activeProjectId && permissionKeys.has("catalog.read") ? ["demo-catalog-001"] : [],
    sourceScopeIds: activeProjectId ? ["demo-sap-001", "demo-normative-001", "demo-system-config-001"] : globalRoleKeys.length ? ["demo-system-config-001"] : [],
    accessClaims,
    authorizationVersion: Number(user.authorization_version ?? 1),
    requestId: randomUUID(),
  };
}

/** Server-only service identity used by durable event ingress and workers. */
export async function resolveServiceAuthorizationContext(
  subjectId: string,
  projectId: string,
): Promise<TrustedRequestContext> {
  const database = await getDatabase();
  const [user] = rows(await database.execute(sql`
    select id, display_name, status, account_type, authorization_version
    from users where id = ${subjectId} limit 1
  `));
  if (!user || user.status !== "ACTIVE" || user.account_type !== "SERVICE_ACCOUNT") {
    throw new AuthorizationError("source.appius.read", "Сервисная учётная запись недоступна");
  }
  const [project] = rows(await database.execute(sql`
    select id from projects where id = ${projectId} and status = 'ACTIVE' limit 1
  `));
  if (!project) throw new AuthorizationError("source.appius.read", "Проект события недоступен");
  const assignments = rows(await database.execute(sql`
    select ra.id, r.key as role_key
    from role_assignments ra join roles r on r.id = ra.role_id
    where ra.user_id = ${subjectId} and ra.status = 'ACTIVE' and r.active = true
      and ra.scope_type = 'SERVICE'
      and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now())
  `));
  const serviceRoleKeys = assignments.map((row) => String(row.role_key) as RoleKey);
  const permissionKeys = expandRolePermissions(serviceRoleKeys);
  const allowedSystems = new Set<string>();
  if (permissionKeys.has("source.appius.read")) allowedSystems.add("SYSTEM_CONFIG");
  if (permissionKeys.has("source.sap.read")) allowedSystems.add("SAP");
  if (permissionKeys.has("source.rag.read")) allowedSystems.add("NORMATIVE");
  const scopeRows = rows(await database.execute(sql`
    select id, source_type from source_scopes where status = 'ACTIVE' order by id
  `));
  return {
    subjectId,
    displayName: String(user.display_name),
    activeRoleAssignmentIds: assignments.map((row) => String(row.id)),
    globalRoleKeys: serviceRoleKeys,
    activeProjectId: projectId,
    projectRoleKeys: [],
    permissionKeys,
    catalogScopeIds: [],
    sourceScopeIds: scopeRows
      .filter((row) => allowedSystems.has(String(row.source_type)))
      .map((row) => String(row.id)),
    accessClaims: {},
    authorizationVersion: Number(user.authorization_version ?? 1),
    requestId: randomUUID(),
  };
}

export function can(ctx: TrustedRequestContext, permission: PermissionKey, resource?: ResourceDescriptor): boolean {
  if (!ctx.permissionKeys.has(permission)) return false;
  if (resource?.projectId && resource.projectId !== ctx.activeProjectId) return false;
  if (resource?.ownerUserId && resource.ownerUserId !== ctx.subjectId) return false;
  const attributes = resource?.accessAttributes;
  if (attributes?.deny === true || attributes?.exportDenied === true && permission.endsWith(".export")) return false;
  const allowedUserIds = Array.isArray(attributes?.allowedUserIds) ? attributes.allowedUserIds.map(String) : [];
  if (allowedUserIds.length > 0 && !allowedUserIds.includes(ctx.subjectId)) return false;
  return true;
}

export function requirePermission(ctx: TrustedRequestContext, permission: PermissionKey, resource?: ResourceDescriptor): void {
  if (!can(ctx, permission, resource)) throw new AuthorizationError(permission);
}

function rows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) return result.rows as Array<Record<string, unknown>>;
  return [];
}

import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import { getDatabase, type Database } from "@/adapters/persistence/db";
import { hasRoleConflict, type RoleKey } from "@/domain/rbac";

export async function listAccessUsers() {
  const db = await getDatabase();
  return rows(await db.execute(sql`
    select u.id, u.login, u.display_name, u.status, u.account_type, u.auth_source, u.last_login_at, u.authorization_version,
      coalesce(json_agg(distinct jsonb_build_object('assignmentId',ra.id,'roleKey',r.key,'roleName',r.name_ru,'scopeType',ra.scope_type,'projectId',ra.project_id,'status',ra.status)) filter (where ra.id is not null), '[]') as assignments
    from users u left join role_assignments ra on ra.user_id=u.id left join roles r on r.id=ra.role_id
    group by u.id order by u.account_type, u.login
  `));
}

export async function listRolesWithPermissions() {
  const db = await getDatabase();
  return rows(await db.execute(sql`
    select r.id, r.key, r.name_ru, r.scope_type, r.description_ru, r.active,
      coalesce(json_agg(jsonb_build_object('key',p.key,'name',p.name_ru,'description',p.description_ru)) filter (where p.key is not null), '[]') as permissions
    from roles r left join role_permissions rp on rp.role_id=r.id left join permissions p on p.key=rp.permission_key
    group by r.id order by case r.scope_type when 'GLOBAL' then 1 when 'PROJECT' then 2 else 3 end, r.name_ru
  `));
}

export async function listProjectMembers(projectId: string) {
  const db = await getDatabase();
  return rows(await db.execute(sql`
    select pm.project_id, pm.user_id, u.login, u.display_name, pm.status, pm.valid_from, pm.valid_until,
      coalesce(json_agg(jsonb_build_object('assignmentId',ra.id,'roleKey',r.key,'roleName',r.name_ru,'status',ra.status)) filter (where ra.id is not null), '[]') as roles
    from project_memberships pm join users u on u.id=pm.user_id
    left join role_assignments ra on ra.user_id=pm.user_id and ra.project_id=pm.project_id
    left join roles r on r.id=ra.role_id
    where pm.project_id=${projectId}
    group by pm.project_id, pm.user_id, u.login, u.display_name, pm.status, pm.valid_from, pm.valid_until order by u.login
  `));
}

export async function setProjectMembership(input: { actorId: string; projectId: string; userId: string; status: "ACTIVE" | "SUSPENDED" }) {
  const db = await getDatabase();
  if (input.status === "SUSPENDED") await assertNotLastProjectManager(db, input.projectId, input.userId);
  await db.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await tx.execute(sql`insert into project_memberships (project_id,user_id,status,valid_from,created_by) values (${input.projectId},${input.userId},${input.status},now(),${input.actorId}) on conflict (project_id,user_id) do update set status=excluded.status, updated_at=now()`);
    if (input.status === "SUSPENDED") await tx.execute(sql`update role_assignments set status='REVOKED', revoked_by=${input.actorId}, revoked_at=now(), updated_at=now() where project_id=${input.projectId} and user_id=${input.userId} and status='ACTIVE'`);
    await tx.execute(sql`update users set authorization_version=authorization_version+1 where id=${input.userId}`);
    await tx.execute(sql`update auth_sessions set revoked_at=now() where user_id=${input.userId} and revoked_at is null`);
    await writeAccessAudit(tx, input.actorId, "RBAC_MEMBERSHIP_CHANGED", input.userId, { projectId: input.projectId, status: input.status });
  });
}

export async function setUserStatus(actorId: string, userId: string, status: "ACTIVE" | "BLOCKED") {
  if (actorId === userId && status === "BLOCKED") throw new Error("Нельзя заблокировать собственную учётную запись");
  const db = await getDatabase();
  if (status === "BLOCKED") await assertNotLastAdministrator(db, userId);
  await db.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await tx.execute(sql`update users set status=${status}, authorization_version=authorization_version+1, updated_at=now() where id=${userId}`);
    await tx.execute(sql`update auth_sessions set revoked_at=now() where user_id=${userId} and revoked_at is null`);
    await writeAccessAudit(tx, actorId, "RBAC_USER_STATUS_CHANGED", userId, { status });
  });
}

export async function assignRole(input: { actorId: string; userId: string; roleKey: RoleKey; projectId?: string | null; validUntil?: string | null }) {
  if (input.actorId === input.userId && ["SYSTEM_ADMIN", "AUDITOR"].includes(input.roleKey)) throw new Error("Нельзя менять собственную глобальную роль");
  const db = await getDatabase();
  const roleRows = rows(await db.execute(sql`select id, scope_type from roles where key=${input.roleKey} and active=true`));
  const role = roleRows[0];
  if (!role) throw new Error("Роль не найдена");
  const scopeType = String(role.scope_type);
  if (scopeType === "SERVICE") throw new Error("Сервисная роль назначается только controlled provisioning");
  if (scopeType === "PROJECT") {
    if (!input.projectId) throw new Error("Для проектной роли обязателен проект");
    const membership = rows(await db.execute(sql`select 1 from project_memberships where project_id=${input.projectId} and user_id=${input.userId} and status='ACTIVE' limit 1`));
    if (!membership.length) throw new Error("Сначала добавьте пользователя в проект");
  }
  const currentRoles = rows(await db.execute(sql`select r.key from role_assignments ra join roles r on r.id=ra.role_id where ra.user_id=${input.userId} and ra.status='ACTIVE'`)).map((row) => String(row.key) as RoleKey);
  if (hasRoleConflict([...currentRoles, input.roleKey])) throw new Error("Назначение нарушает разделение обязанностей");
  await db.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await tx.execute(sql`insert into role_assignments (id,user_id,role_id,scope_type,project_id,status,valid_until,assigned_by) values (${`assign-${randomUUID()}`},${input.userId},${String(role.id)},${scopeType},${scopeType === "PROJECT" ? input.projectId ?? null : null},'ACTIVE',${input.validUntil ?? null},${input.actorId}) on conflict do nothing`);
    await tx.execute(sql`update users set authorization_version=authorization_version+1, updated_at=now() where id=${input.userId}`);
    await tx.execute(sql`update auth_sessions set revoked_at=now() where user_id=${input.userId} and revoked_at is null`);
    await writeAccessAudit(tx, input.actorId, "RBAC_ROLE_ASSIGNED", input.userId, { roleKey: input.roleKey, projectId: input.projectId ?? null });
  });
}

export async function revokeAssignment(actorId: string, assignmentId: string) {
  const db = await getDatabase();
  const found = rows(await db.execute(sql`select ra.user_id, r.key from role_assignments ra join roles r on r.id=ra.role_id where ra.id=${assignmentId} and ra.status='ACTIVE' limit 1`))[0];
  if (!found) throw new Error("Активное назначение не найдено");
  if (actorId === found.user_id && ["SYSTEM_ADMIN", "AUDITOR"].includes(String(found.key))) throw new Error("Нельзя отозвать собственную глобальную роль");
  if (found.key === "SYSTEM_ADMIN") await assertNotLastAdministrator(db, String(found.user_id));
  if (found.key === "PROJECT_MANAGER") {
    const assignment = rows(await db.execute(sql`select project_id from role_assignments where id=${assignmentId}`))[0];
    if (assignment?.project_id) await assertNotLastProjectManager(db, String(assignment.project_id), String(found.user_id));
  }
  await db.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await tx.execute(sql`update role_assignments set status='REVOKED', revoked_by=${actorId}, revoked_at=now(), updated_at=now() where id=${assignmentId}`);
    await tx.execute(sql`update users set authorization_version=authorization_version+1 where id=${String(found.user_id)}`);
    await tx.execute(sql`update auth_sessions set revoked_at=now() where user_id=${String(found.user_id)} and revoked_at is null`);
    await writeAccessAudit(tx, actorId, "RBAC_ROLE_REVOKED", String(found.user_id), { assignmentId, roleKey: found.key });
  });
}

export async function changeProjectRole(input: {
  actorId: string;
  userId: string;
  projectId: string;
  currentAssignmentId: string;
  fromRoleKey: Extract<RoleKey, "PROJECT_VIEWER" | "MTR_ANALYST" | "MTR_EXPERT" | "PROJECT_MANAGER">;
  toRoleKey: Extract<RoleKey, "PROJECT_VIEWER" | "MTR_ANALYST" | "MTR_EXPERT" | "PROJECT_MANAGER">;
}) {
  if (input.actorId === input.userId) throw new Error("Нельзя менять собственную проектную роль через чат");
  if (input.fromRoleKey === input.toRoleKey) return;
  const db = await getDatabase();
  await db.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    const [membership] = rows(await tx.execute(sql`
      select status from project_memberships
      where project_id=${input.projectId} and user_id=${input.userId}
      for update
    `));
    if (membership?.status !== "ACTIVE") throw new Error("Пользователь не состоит в проекте");
    const [current] = rows(await tx.execute(sql`
      select ra.id, ra.user_id, ra.project_id, r.key
      from role_assignments ra join roles r on r.id=ra.role_id
      where ra.id=${input.currentAssignmentId} and ra.user_id=${input.userId}
        and ra.project_id=${input.projectId} and ra.status='ACTIVE'
      for update
    `));
    if (!current || current.key !== input.fromRoleKey) throw new Error("Текущее назначение роли изменилось");
    const [targetRole] = rows(await tx.execute(sql`
      select id, scope_type from roles where key=${input.toRoleKey} and active=true limit 1
    `));
    if (!targetRole || targetRole.scope_type !== "PROJECT") throw new Error("Проектная роль недоступна");
    if (input.fromRoleKey === "PROJECT_MANAGER") {
      const [managers] = rows(await tx.execute(sql`
        select count(distinct ra.user_id)::int as count
        from role_assignments ra join roles r on r.id=ra.role_id
        join project_memberships pm on pm.project_id=ra.project_id and pm.user_id=ra.user_id
        join users u on u.id=ra.user_id
        where ra.project_id=${input.projectId} and r.key='PROJECT_MANAGER'
          and ra.status='ACTIVE' and pm.status='ACTIVE' and u.status='ACTIVE'
      `));
      if (Number(managers?.count ?? 0) <= 1) throw new Error("Нельзя удалить последнего руководителя проекта");
    }
    const currentRoles = rows(await tx.execute(sql`
      select r.key from role_assignments ra join roles r on r.id=ra.role_id
      where ra.user_id=${input.userId} and ra.status='ACTIVE' and ra.id<>${input.currentAssignmentId}
    `)).map((row) => String(row.key) as RoleKey);
    if (hasRoleConflict([...currentRoles, input.toRoleKey])) throw new Error("Назначение нарушает разделение обязанностей");
    await tx.execute(sql`
      update role_assignments set status='REVOKED', revoked_by=${input.actorId}, revoked_at=now(), updated_at=now()
      where id=${input.currentAssignmentId} and status='ACTIVE'
    `);
    await tx.execute(sql`
      insert into role_assignments (id,user_id,role_id,scope_type,project_id,status,assigned_by)
      values (${`assign-${randomUUID()}`},${input.userId},${String(targetRole.id)},'PROJECT',${input.projectId},'ACTIVE',${input.actorId})
    `);
    await tx.execute(sql`update users set authorization_version=authorization_version+1, updated_at=now() where id=${input.userId}`);
    await tx.execute(sql`update auth_sessions set revoked_at=now() where user_id=${input.userId} and revoked_at is null`);
    await writeAccessAudit(tx, input.actorId, "RBAC_PROJECT_ROLE_CHANGED", input.userId, {
      projectId: input.projectId,
      fromRoleKey: input.fromRoleKey,
      toRoleKey: input.toRoleKey,
    });
  });
}

export async function setRoleStatus(input: {
  actorId: string;
  roleKey: Extract<RoleKey, "PROJECT_VIEWER" | "MTR_ANALYST" | "MTR_EXPERT" | "PROJECT_MANAGER">;
  active: boolean;
  approvedReassignmentPlan: false;
}) {
  const db = await getDatabase();
  await db.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    const [role] = rows(await tx.execute(sql`
      select id, active, scope_type from roles where key=${input.roleKey} for update
    `));
    if (!role || role.scope_type !== "PROJECT") throw new Error("Роль недоступна для управления через чат");
    if (Boolean(role.active) === input.active) return;
    const [assignmentCount] = rows(await tx.execute(sql`
      select count(*)::int as count from role_assignments
      where role_id=${String(role.id)} and status='ACTIVE'
    `));
    if (!input.active && Number(assignmentCount?.count ?? 0) > 0 && !input.approvedReassignmentPlan) {
      throw new Error("Сначала требуется утверждённый план переназначения активных сотрудников");
    }
    await tx.execute(sql`update roles set active=${input.active}, updated_at=now() where id=${String(role.id)}`);
    await writeAccessAudit(tx, input.actorId, "RBAC_ROLE_STATUS_CHANGED", String(role.id), {
      roleKey: input.roleKey,
      active: input.active,
      affectedAssignments: Number(assignmentCount?.count ?? 0),
    });
  });
}

async function assertNotLastProjectManager(db: Database, projectId: string, userId: string) {
  const result = rows(await db.execute(sql`select count(distinct ra.user_id)::int as count from role_assignments ra join roles r on r.id=ra.role_id join project_memberships pm on pm.project_id=ra.project_id and pm.user_id=ra.user_id join users u on u.id=ra.user_id where ra.project_id=${projectId} and r.key='PROJECT_MANAGER' and ra.status='ACTIVE' and pm.status='ACTIVE' and u.status='ACTIVE'`))[0];
  const hasRole = rows(await db.execute(sql`select 1 from role_assignments ra join roles r on r.id=ra.role_id where ra.project_id=${projectId} and ra.user_id=${userId} and r.key='PROJECT_MANAGER' and ra.status='ACTIVE' limit 1`));
  if (hasRole.length && Number(result?.count ?? 0) <= 1) throw new Error("Нельзя удалить последнего руководителя проекта");
}

async function assertNotLastAdministrator(db: Database, userId: string) {
  const result = rows(await db.execute(sql`select count(distinct ra.user_id)::int as count from role_assignments ra join roles r on r.id=ra.role_id join users u on u.id=ra.user_id where r.key='SYSTEM_ADMIN' and ra.status='ACTIVE' and u.status='ACTIVE'`))[0];
  const hasRole = rows(await db.execute(sql`select 1 from role_assignments ra join roles r on r.id=ra.role_id where ra.user_id=${userId} and r.key='SYSTEM_ADMIN' and ra.status='ACTIVE' limit 1`));
  if (hasRole.length && Number(result?.count ?? 0) <= 1) throw new Error("Нельзя удалить или заблокировать последнего активного администратора");
}

async function writeAccessAudit(db: Database, actorId: string, action: string, entityId: string, details: Record<string, unknown>) {
  const actor = rows(await db.execute(sql`select display_name from users where id=${actorId} limit 1`))[0];
  await db.execute(sql`insert into audit_logs (id,user_id,actor_display_name,action,entity_type,entity_id,outcome,details,retention_until,request_id) values (${`audit-${randomUUID()}`},'demo-user-001',${String(actor?.display_name ?? "Системный пользователь")},${action},'RBAC',${entityId},'SUCCESS',${JSON.stringify(details)}::jsonb,now()+interval '1 year',${randomUUID()})`);
}

function rows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) return result.rows as Array<Record<string, unknown>>;
  return [];
}

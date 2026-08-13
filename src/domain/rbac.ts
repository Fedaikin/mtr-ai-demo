export const PERMISSION_KEYS = [
  "profile.read.own", "project.read", "project.members.manage",
  "specification.read", "specification.history.read", "specification.upload", "specification.publish", "specification.archive",
  "catalog.read", "catalog.substitutes.read", "catalog.bom.read", "stock.search", "stock.import",
  "analysis.create", "analysis.read", "analysis.cancel.own", "analysis.cancel.any", "analysis.retry.own", "analysis.retry.any",
  "review.read", "review.queue.read", "review.assign", "review.decide", "result.override",
  "report.read", "report.publish", "report.archive", "report.export",
  "agent.chat", "agent.logs.read", "user.manage", "global_role.manage",
  "integration.read", "integration.manage", "prompt.manage", "prompt.activate", "dictionary.manage", "scenario_template.manage",
  "audit.read.own", "audit.read.project", "audit.read.global", "audit.export",
  "demo.reset", "demo.catalog.reset", "source.appius.read", "source.sap.read", "source.rag.read", "sink.siem.write",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export type RoleKey = "SYSTEM_ADMIN" | "AUDITOR" | "INTEGRATION_SERVICE" | "PROJECT_VIEWER" | "MTR_ANALYST" | "MTR_EXPERT" | "PROJECT_MANAGER";
export type RoleScope = "GLOBAL" | "PROJECT" | "SERVICE";

export const ROLE_LABELS: Record<RoleKey, string> = {
  SYSTEM_ADMIN: "Системный администратор",
  AUDITOR: "Аудитор",
  INTEGRATION_SERVICE: "Интеграционная служба",
  PROJECT_VIEWER: "Наблюдатель проекта",
  MTR_ANALYST: "Аналитик МТР",
  MTR_EXPERT: "Эксперт МТР",
  PROJECT_MANAGER: "Руководитель проекта",
};

export const ROLE_HIERARCHY: Partial<Record<RoleKey, readonly RoleKey[]>> = {
  MTR_ANALYST: ["PROJECT_VIEWER"],
  MTR_EXPERT: ["PROJECT_VIEWER"],
  PROJECT_MANAGER: ["MTR_ANALYST"],
};

export const ROLE_PERMISSION_BUNDLES: Record<RoleKey, readonly PermissionKey[]> = {
  PROJECT_VIEWER: ["profile.read.own", "project.read", "specification.read", "specification.history.read", "catalog.read", "catalog.substitutes.read", "catalog.bom.read", "analysis.read", "review.read", "report.read", "report.export", "agent.chat", "audit.read.own"],
  MTR_ANALYST: ["specification.upload", "specification.publish", "stock.search", "stock.import", "analysis.create", "analysis.cancel.own", "analysis.retry.own"],
  MTR_EXPERT: ["stock.search", "analysis.create", "analysis.cancel.own", "analysis.retry.own", "review.queue.read", "review.decide", "result.override"],
  PROJECT_MANAGER: ["project.members.manage", "specification.archive", "analysis.cancel.any", "analysis.retry.any", "review.queue.read", "review.assign", "report.publish", "report.archive", "audit.read.project"],
  SYSTEM_ADMIN: ["profile.read.own", "user.manage", "global_role.manage", "integration.read", "integration.manage", "prompt.manage", "prompt.activate", "dictionary.manage", "scenario_template.manage", "agent.logs.read", "audit.read.global", "demo.reset", "demo.catalog.reset"],
  AUDITOR: ["profile.read.own", "agent.logs.read", "audit.read.global", "audit.export"],
  INTEGRATION_SERVICE: ["source.appius.read", "source.sap.read", "source.rag.read", "sink.siem.write"],
};

export function expandRolePermissions(roleKeys: readonly RoleKey[]): Set<PermissionKey> {
  const permissions = new Set<PermissionKey>();
  const visited = new Set<RoleKey>();
  const visit = (role: RoleKey) => {
    if (visited.has(role)) return;
    visited.add(role);
    for (const permission of ROLE_PERMISSION_BUNDLES[role]) permissions.add(permission);
    for (const inherited of ROLE_HIERARCHY[role] ?? []) visit(inherited);
  };
  for (const role of roleKeys) visit(role);
  return permissions;
}

export function hasRoleConflict(roleKeys: readonly RoleKey[]): boolean {
  const roles = new Set(roleKeys);
  return roles.has("AUDITOR") && ["SYSTEM_ADMIN", "MTR_ANALYST", "MTR_EXPERT", "PROJECT_MANAGER"].some((role) => roles.has(role as RoleKey));
}

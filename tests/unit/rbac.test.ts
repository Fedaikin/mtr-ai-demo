import { describe, expect, it } from "vitest";

import { expandRolePermissions, hasRoleConflict, type PermissionKey, type RoleKey } from "@/domain/rbac";

describe("scoped RBAC", () => {
  const positive: Array<[RoleKey, PermissionKey]> = [
    ["PROJECT_VIEWER", "project.read"], ["PROJECT_VIEWER", "catalog.read"], ["PROJECT_VIEWER", "agent.chat"],
    ["MTR_ANALYST", "analysis.create"], ["MTR_ANALYST", "project.read"], ["MTR_ANALYST", "specification.upload"],
    ["MTR_EXPERT", "review.decide"], ["MTR_EXPERT", "review.queue.read"], ["MTR_EXPERT", "catalog.read"],
    ["PROJECT_MANAGER", "project.members.manage"], ["PROJECT_MANAGER", "analysis.create"], ["PROJECT_MANAGER", "report.publish"],
    ["SYSTEM_ADMIN", "user.manage"], ["SYSTEM_ADMIN", "scenario_template.manage"], ["SYSTEM_ADMIN", "audit.read.global"],
    ["AUDITOR", "audit.read.global"], ["AUDITOR", "audit.export"], ["INTEGRATION_SERVICE", "source.sap.read"],
  ];
  it.each(positive)("%s grants %s", (role, permission) => expect(expandRolePermissions([role]).has(permission)).toBe(true));

  const negative: Array<[RoleKey, PermissionKey]> = [
    ["PROJECT_VIEWER", "analysis.create"], ["PROJECT_VIEWER", "stock.search"], ["PROJECT_VIEWER", "review.decide"],
    ["MTR_ANALYST", "project.members.manage"], ["MTR_ANALYST", "analysis.cancel.any"], ["MTR_EXPERT", "user.manage"],
    ["PROJECT_MANAGER", "global_role.manage"], ["SYSTEM_ADMIN", "analysis.create"], ["SYSTEM_ADMIN", "report.read"],
    ["AUDITOR", "user.manage"], ["AUDITOR", "analysis.create"], ["INTEGRATION_SERVICE", "project.read"],
  ];
  it.each(negative)("%s does not grant %s", (role, permission) => expect(expandRolePermissions([role]).has(permission)).toBe(false));

  it("inherits analyst into manager", () => expect(expandRolePermissions(["PROJECT_MANAGER"]).has("specification.upload")).toBe(true));
  it("detects auditor and admin conflict", () => expect(hasRoleConflict(["AUDITOR", "SYSTEM_ADMIN"])).toBe(true));
  it("allows auditor with viewer", () => expect(hasRoleConflict(["AUDITOR", "PROJECT_VIEWER"])).toBe(false));
});

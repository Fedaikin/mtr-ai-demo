import { describe, expect, it } from "vitest";

import { dashboardAudienceForPersona, DEMO_PERSONAS, landingPathForPermissions } from "@/domain/demo-personas";

describe("demo personas", () => {
  it("offers seven interactive human personas", () => expect(DEMO_PERSONAS.map((persona) => persona.login)).toEqual(["viewer", "analyst", "expert", "demo", "director", "admin", "auditor"]));
  it.each([
    ["analyst", ["MTR_ANALYST"], "SPECIALIST"],
    ["expert", ["MTR_EXPERT"], "SPECIALIST"],
    ["demo", ["PROJECT_MANAGER"], "MANAGER"],
    ["director", ["PROJECT_VIEWER"], "EXECUTIVE"],
    ["viewer", ["PROJECT_VIEWER"], "OBSERVER"],
  ])("maps %s to the %s dashboard audience", (login, roles, audience) => {
    expect(dashboardAudienceForPersona(login, roles)).toBe(audience);
  });
  it("routes project roles to the project overview", () => expect(landingPathForPermissions(new Set(["project.read"]))).toBe("/"));
  it("routes the administrator to access management", () => expect(landingPathForPermissions(new Set(["user.manage"]))).toBe("/admin/users"));
  it("routes the auditor to audit", () => expect(landingPathForPermissions(new Set(["audit.read.global"]))).toBe("/admin/audit"));
});

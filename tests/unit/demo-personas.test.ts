import { describe, expect, it } from "vitest";

import { DEMO_PERSONAS, landingPathForPermissions } from "@/domain/demo-personas";

describe("demo personas", () => {
  it("offers six interactive human personas", () => expect(DEMO_PERSONAS.map((persona) => persona.login)).toEqual(["viewer", "analyst", "expert", "demo", "admin", "auditor"]));
  it("routes project roles to the project overview", () => expect(landingPathForPermissions(new Set(["project.read"]))).toBe("/"));
  it("routes the administrator to access management", () => expect(landingPathForPermissions(new Set(["user.manage"]))).toBe("/admin/users"));
  it("routes the auditor to audit", () => expect(landingPathForPermissions(new Set(["audit.read.global"]))).toBe("/admin/audit"));
});

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { privilegedActionParametersSchema } from "@/domain/agent/privileged-actions";
import { PROJECT_AGENT_ACTION_TYPES } from "@/domain/agent/actions";
import { actionProposalSchema } from "@/app/api/agent/actions/_shared";

describe("privileged action contracts", () => {
  it("accepts only strict discriminated L3 parameters", () => {
    expect(privilegedActionParametersSchema.parse({
      actionType: "SET_USER_STATUS",
      targetUserId: "user-1",
      status: "BLOCKED",
    })).toMatchObject({ actionType: "SET_USER_STATUS", status: "BLOCKED" });
    expect(() => privilegedActionParametersSchema.parse({
      actionType: "SET_USER_STATUS",
      targetUserId: "user-1",
      status: "BLOCKED",
      permissions: ["global_role.manage"],
    })).toThrow();
  });

  it("keeps the legacy generic proposal route closed to privileged action types", () => {
    expect(PROJECT_AGENT_ACTION_TYPES).not.toContain("SET_USER_STATUS");
    expect(() => actionProposalSchema.parse({
      caseId: "case-1",
      actionType: "SET_USER_STATUS",
      resource: { resourceType: "USER_ACCESS", resourceId: "user-1", projectId: "project-1" },
      summary: "Заблокировать",
      consequences: ["Сессии будут отозваны"],
      parameters: { targetUserId: "user-1", status: "BLOCKED" },
      requestKey: "request-1",
    })).toThrow();
  });
});

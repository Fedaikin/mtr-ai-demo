import type { TrustedRequestContext } from "@/application/authorization-service";
import { AgentTaskService } from "@/application/agent-orchestrator/task-service";
import { createAgentExecutionContext } from "@/domain/agent/context";
import type {
  AnalysisReviewDecisionReadPort,
  AnalysisReviewDecisionTaskRecord,
} from "@/ports/agent-tasks";

vi.mock("server-only", () => ({}));

function trusted(permissionKeys: TrustedRequestContext["permissionKeys"] = new Set(["review.read"])) {
  return {
    subjectId: "user-1",
    displayName: "Эксперт",
    activeRoleAssignmentIds: ["assignment-1"],
    globalRoleKeys: [],
    activeProjectId: "project-1",
    projectRoleKeys: ["MTR_EXPERT"],
    permissionKeys,
    catalogScopeIds: ["catalog-1"],
    sourceScopeIds: ["source-1"],
    accessClaims: {},
    authorizationVersion: 4,
    requestId: "request-1",
  } satisfies TrustedRequestContext;
}

function record(
  id: string,
  patch: Partial<AnalysisReviewDecisionTaskRecord> = {},
): AnalysisReviewDecisionTaskRecord {
  return {
    id,
    ownerSubjectId: "user-1",
    projectId: "project-1",
    runId: "run-1",
    resultId: `result-${id}`,
    positionId: `position-${id}`,
    status: "PENDING",
    doublecheckOutcome: "HUMAN_REVIEW_REQUIRED",
    createdAt: "2026-08-10T10:00:00.000Z",
    updatedAt: "2026-08-12T10:00:00.000Z",
    decidedAt: null,
    ...patch,
  };
}

describe("AgentTaskService projection из analysis_review_decisions", () => {
  it("запрашивает и повторно фильтрует owner + activeProject", async () => {
    const list = vi.fn(async () => ({
      snapshotAt: "2026-08-13T08:00:00.000Z",
      availability: "COMPLETE" as const,
      complete: true,
      items: [
        record("mine"),
        record("foreign-owner", { ownerSubjectId: "user-2" }),
        record("foreign-project", { projectId: "project-2" }),
      ],
      missingData: [],
    }));
    const service = new AgentTaskService({ list } satisfies AnalysisReviewDecisionReadPort);
    const context = createAgentExecutionContext(trusted(), {
      selection: { projectId: "project-1" },
    });

    const snapshot = await service.listPersonal(context);

    expect(list).toHaveBeenCalledWith(context, {
      ownerSubjectId: "user-1",
      projectId: "project-1",
    });
    expect(snapshot.tasks.map((task) => task.id)).toEqual(["mine"]);
    expect(snapshot.tasks[0]).toMatchObject({
      status: "REQUIRES_DECISION",
      priority: "HIGH",
      reviewDecisionId: "mine",
      projectId: "project-1",
    });
    expect(snapshot.tasks[0]?.href).toBe("/reviews?review=mine");
    expect(snapshot.tasks[0]?.href.startsWith("//")).toBe(false);
  });

  it("отдаёт только canonical status/priority и понижает completeness для неизвестной строки", async () => {
    const list = vi.fn(async () => ({
      snapshotAt: "2026-08-13T08:00:00.000Z",
      availability: "COMPLETE" as const,
      complete: true,
      items: [
        record("returned", { status: "RETURNED" }),
        record("done", { status: "CONFIRMED", doublecheckOutcome: "CONFIRMED_FOR_HUMAN_REVIEW" }),
        record("legacy-auto", { status: "AUTO_CONFIRMED" }),
        record("unknown", { status: "SECRET_INTERNAL_STATUS" }),
      ],
      missingData: [],
    }));
    const snapshot = await new AgentTaskService({ list }).listPersonal(
      createAgentExecutionContext(trusted(), { selection: { projectId: "project-1" } }),
    );

    expect(snapshot.tasks.map(({ status, priority }) => ({ status, priority }))).toEqual(
      expect.arrayContaining([
        { status: "RETURNED_FOR_CLARIFICATION", priority: "HIGH" },
        { status: "COMPLETED", priority: "LOW" },
        { status: "REQUIRES_DECISION", priority: "HIGH" },
      ]),
    );
    expect(snapshot.tasks.some((task) => task.id === "unknown")).toBe(false);
    expect(snapshot.availability).toBe("PARTIAL");
    expect(snapshot.complete).toBe(false);
  });

  it("не обращается к adapter без review.read", async () => {
    const list = vi.fn();
    const service = new AgentTaskService({ list });
    const context = createAgentExecutionContext(trusted(new Set()), {
      selection: { projectId: "project-1" },
    });

    await expect(service.listPersonal(context)).rejects.toMatchObject({ permission: "review.read" });
    expect(list).not.toHaveBeenCalled();
  });

  it("не принимает client project вместо canonical activeProject", async () => {
    const list = vi.fn();
    const service = new AgentTaskService({ list });
    const context = createAgentExecutionContext(trusted(), {
      selection: { projectId: "project-1" },
    });

    await expect(service.listPersonal(context, { projectId: "project-2" })).rejects.toMatchObject({
      code: "AGENT_TASK_PROJECT_DENIED",
    });
    expect(list).not.toHaveBeenCalled();
  });
});

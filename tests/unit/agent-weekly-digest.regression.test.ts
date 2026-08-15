import type { TrustedRequestContext } from "@/application/authorization-service";
import { WeeklyDigestService } from "@/application/agent-orchestrator/digest-service";
import { AgentTaskService } from "@/application/agent-orchestrator/task-service";
import { createAgentExecutionContext } from "@/domain/agent/context";
import type {
  AnalysisReviewDecisionReadPort,
  WeeklyDigestSourcePort,
  WeeklyDigestSourceSnapshot,
} from "@/ports/agent-tasks";

vi.mock("server-only", () => ({}));

const NOW = new Date("2026-10-26T12:00:00.000Z");

function trusted(role: "PROJECT_VIEWER" | "MTR_ANALYST" | "MTR_EXPERT" | "PROJECT_MANAGER") {
  const permissions = new Set<TrustedRequestContext["permissionKeys"] extends ReadonlySet<infer P> ? P : never>([
    "agent.chat",
    "project.read",
    "review.read",
    "analysis.read",
  ]);
  return {
    subjectId: "user-1",
    displayName: "Пользователь",
    activeRoleAssignmentIds: ["assignment-1"],
    globalRoleKeys: [],
    activeProjectId: "project-1",
    projectRoleKeys: [role],
    permissionKeys: permissions,
    catalogScopeIds: ["catalog-1"],
    sourceScopeIds: ["source-1"],
    accessClaims: {},
    authorizationVersion: 4,
    requestId: "request-1",
  } satisfies TrustedRequestContext;
}

function taskPort(): AnalysisReviewDecisionReadPort {
  return {
    list: vi.fn(async () => ({
      snapshotAt: NOW.toISOString(),
      availability: "COMPLETE" as const,
      complete: true,
      items: [
        {
          id: "review-1",
          ownerSubjectId: "user-1",
          projectId: "project-1",
          runId: "run-1",
          resultId: "result-1",
          positionId: "position-task",
          status: "PENDING",
          doublecheckOutcome: "HUMAN_REVIEW_REQUIRED",
          createdAt: "2026-10-20T10:00:00.000Z",
          updatedAt: "2026-10-21T10:00:00.000Z",
          decidedAt: null,
        },
      ],
      missingData: [],
    })),
  };
}

function sourceSnapshot(): WeeklyDigestSourceSnapshot {
  return {
    snapshotAt: NOW.toISOString(),
    sources: {
      specifications: { availability: "COMPLETE", complete: true, snapshotAt: NOW.toISOString(), missingData: [] },
      positions: { availability: "COMPLETE", complete: true, snapshotAt: NOW.toISOString(), missingData: [] },
      kpi: { availability: "PARTIAL", complete: false, snapshotAt: NOW.toISOString(), missingData: [{ code: "KPI_LAG", message: "Часть KPI задержана" }] },
    },
    specificationChanges: [
      {
        id: "spec-event-own",
        projectId: "project-1",
        specificationId: "spec-1",
        title: "Обновлена спецификация",
        changeType: "UPDATED",
        version: "v2",
        visibility: "PROJECT",
        affectedSubjectIds: ["user-1"],
        occurredAt: "2026-10-20T08:00:00.000Z",
      },
      {
        id: "spec-event-foreign-project",
        projectId: "project-2",
        specificationId: "spec-secret",
        title: "Секретная спецификация",
        changeType: "UPDATED",
        version: "v9",
        visibility: "PROJECT",
        affectedSubjectIds: ["user-1"],
        occurredAt: "2026-10-20T08:00:00.000Z",
      },
    ],
    positionChanges: [
      {
        id: "position-own",
        projectId: "project-1",
        specificationId: "spec-1",
        positionId: "position-1",
        kind: "EXPERT_REVIEW",
        title: "Требуется экспертиза",
        affectedSubjectIds: ["user-1"],
        occurredAt: "2026-10-22T08:00:00.000Z",
      },
      {
        id: "position-other-user",
        projectId: "project-1",
        specificationId: "spec-1",
        positionId: "position-secret",
        kind: "EXPERT_REVIEW",
        title: "Чужая экспертиза",
        affectedSubjectIds: ["user-2"],
        occurredAt: "2026-10-22T08:00:00.000Z",
      },
    ],
    kpiChanges: [
      {
        id: "kpi-own",
        projectId: "project-1",
        subjectId: "user-1",
        scope: "EXPERT",
        label: "Срок экспертизы",
        currentValue: 4,
        previousValue: 6,
        unit: "ч",
        occurredAt: "2026-10-23T08:00:00.000Z",
      },
      {
        id: "kpi-other-user",
        projectId: "project-1",
        subjectId: "user-2",
        scope: "PERSONAL",
        label: "Чужой KPI",
        currentValue: 99,
        previousValue: 1,
        unit: "%",
        occurredAt: "2026-10-23T08:00:00.000Z",
      },
      {
        id: "kpi-previous",
        projectId: "project-1",
        subjectId: "user-1",
        scope: "EXPERT",
        label: "Срок экспертизы",
        currentValue: 6,
        previousValue: 7,
        unit: "ч",
        occurredAt: "2026-10-15T08:00:00.000Z",
      },
    ],
  };
}

describe("WeeklyDigestService", () => {
  it("строит две календарные 7-дневные недели через DST, а не 168-часовые окна", async () => {
    const sources: WeeklyDigestSourcePort = { read: vi.fn(async () => sourceSnapshot()) };
    const context = createAgentExecutionContext(trusted("MTR_EXPERT"), {
      selection: { projectId: "project-1" },
      timezone: "Europe/Berlin",
    });
    const digest = await new WeeklyDigestService(
      sources,
      new AgentTaskService(taskPort()),
      { now: () => NOW },
    ).generate(context);

    expect(digest.period).toEqual({
      from: "2026-10-18T22:00:00.000Z",
      to: "2026-10-25T23:00:00.000Z",
      timezone: "Europe/Berlin",
    });
    expect(digest.previousPeriod).toEqual({
      from: "2026-10-11T22:00:00.000Z",
      to: "2026-10-18T22:00:00.000Z",
      timezone: "Europe/Berlin",
    });
    expect(Date.parse(digest.period.to) - Date.parse(digest.period.from)).toBe(169 * 60 * 60_000);
  });

  it("фильтрует project и affected user, показывает role-aware sections и ровно 3 safe action", async () => {
    const read = vi.fn(async () => sourceSnapshot());
    const context = createAgentExecutionContext(trusted("MTR_EXPERT"), {
      selection: { projectId: "project-1" },
      timezone: "Europe/Berlin",
    });
    const digest = await new WeeklyDigestService(
      { read },
      new AgentTaskService(taskPort()),
      { now: () => NOW },
    ).generate(context);

    expect(read).toHaveBeenCalledWith(context, expect.objectContaining({
      projectId: "project-1",
      subjectId: "user-1",
      period: digest.period,
      previousPeriod: digest.previousPeriod,
    }));
    expect(digest.sections.specificationChanges.map((item) => item.specificationId)).toEqual(["spec-1"]);
    expect(digest.sections.positionChanges.map((item) => item.positionId)).toEqual(["position-1"]);
    expect(digest.sections.kpiChanges.map((item) => item.id)).toEqual(["kpi-own"]);
    expect(JSON.stringify(digest)).not.toContain("secret");
    expect(JSON.stringify(digest)).not.toContain("user-2");
    expect(digest.recommendedActions).toHaveLength(3);
    expect(digest.recommendedActions.every((action) => action.href.startsWith("/") && !action.href.startsWith("//"))).toBe(true);
    expect(digest.status).toBe("PARTIAL");
    expect(digest.sources.kpi).toMatchObject({ availability: "PARTIAL", complete: false });
    expect(digest.comparison.find((metric) => metric.key === "KPI")).toMatchObject({
      current: 1,
      previous: 1,
      delta: 0,
    });
  });

  it("viewer видит только published specification changes и не получает personal sections", async () => {
    const snapshot = sourceSnapshot();
    const sources: WeeklyDigestSourcePort = {
      read: vi.fn(async () => ({
        ...snapshot,
        specificationChanges: snapshot.specificationChanges.map((item) => ({
          ...item,
          visibility: item.id === "spec-event-own" ? "PUBLISHED" as const : item.visibility,
        })),
      })),
    };
    const taskRead = vi.fn();
    const digest = await new WeeklyDigestService(
      sources,
      new AgentTaskService({ list: taskRead }),
      { now: () => NOW },
    ).generate(createAgentExecutionContext(trusted("PROJECT_VIEWER"), {
      selection: { projectId: "project-1" },
      timezone: "Europe/Berlin",
    }));

    expect(digest.roleView).toBe("VIEWER");
    expect(digest.sections.specificationChanges).toHaveLength(1);
    expect(digest.sections.positionChanges).toEqual([]);
    expect(digest.sections.kpiChanges).toEqual([]);
    expect(digest.sections.tasks).toEqual([]);
    expect(taskRead).not.toHaveBeenCalled();
  });

  it("возвращает честный UNAVAILABLE и 3 безопасных действия при отказе всех источников", async () => {
    const digest = await new WeeklyDigestService(
      { read: vi.fn(async () => { throw new Error("source failed"); }) },
      new AgentTaskService({ list: vi.fn(async () => { throw new Error("task failed"); }) }),
      { now: () => NOW },
    ).generate(createAgentExecutionContext(trusted("MTR_EXPERT"), {
      selection: { projectId: "project-1" },
      timezone: "Europe/Berlin",
    }));

    expect(digest.status).toBe("UNAVAILABLE");
    expect(Object.values(digest.sources).every((source) => source.availability === "UNAVAILABLE")).toBe(true);
    expect(digest.recommendedActions).toHaveLength(3);
    expect(digest.recommendedActions.every((action) => action.href.startsWith("/") && !action.href.startsWith("//"))).toBe(true);
    expect(JSON.stringify(digest)).not.toContain("source failed");
    expect(JSON.stringify(digest)).not.toContain("task failed");
  });
});

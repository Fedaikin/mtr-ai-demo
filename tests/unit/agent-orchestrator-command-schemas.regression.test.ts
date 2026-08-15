import { parseAgentCommandRequest } from "@/application/agent-orchestrator/command-schemas";
import {
  TASK_REVIEW_PRIORITIES,
  TASK_REVIEW_STATUSES,
} from "@/domain/agent/task-review";

describe("контракт быстрых команд МТР-агента", () => {
  it("использует канонические статусы и приоритеты задач", () => {
    const request = parseAgentCommandRequest("MY_TASKS", {
      context: { projectId: "demo-project-001" },
      filters: {
        statuses: [...TASK_REVIEW_STATUSES],
        priorities: [...TASK_REVIEW_PRIORITIES],
      },
    });

    expect(request.filters).toEqual({
      statuses: TASK_REVIEW_STATUSES,
      priorities: TASK_REVIEW_PRIORITIES,
    });
  });

  it.each(["OPEN", "WAITING", "MEDIUM"])("отклоняет неканонический literal %s", (value) => {
    const field = value === "MEDIUM" ? "priorities" : "statuses";
    expect(() =>
      parseAgentCommandRequest("MY_TASKS", {
        context: {},
        filters: { [field]: [value] },
      }),
    ).toThrow();
  });

  it("сохраняет все server-side фильтры команды", () => {
    expect(
      parseAgentCommandRequest("STOCKS", {
        context: {
          projectId: "demo-project-001",
          specificationId: "spec-1",
          positionId: "position-1",
          period: {
            from: "2026-08-01T00:00:00.000Z",
            to: "2026-08-08T00:00:00.000Z",
          },
        },
        filters: {
          query: "подшипник",
          warehouseIds: ["WH-01", "WH-02"],
        },
      }),
    ).toMatchObject({
      context: {
        specificationId: "spec-1",
        positionId: "position-1",
      },
      filters: { warehouseIds: ["WH-01", "WH-02"] },
    });
  });

  it.each(["userId", "role", "permissions", "authorizationVersion", "sourceScopeIds"])(
    "не принимает доверенное поле %s из HTTP body",
    (field) => {
      expect(() =>
        parseAgentCommandRequest("SUMMARY", { context: {}, [field]: "forged" }),
      ).toThrow();
    },
  );

  it("валидирует allowlisted параметры аналитического сценария", () => {
    expect(
      parseAgentCommandRequest("ANALYSIS", {
        context: { projectId: "demo-project-001" },
        filters: {
          positionId: "position-portfolio-072-003",
          horizonWeeks: 8,
          demandMultiplier: 1.2,
          deliveryDelayDays: 14,
        },
      }),
    ).toMatchObject({
      commandKey: "ANALYSIS",
      filters: { horizonWeeks: 8, demandMultiplier: 1.2, deliveryDelayDays: 14 },
    });
    expect(() =>
      parseAgentCommandRequest("ANALYSIS", {
        context: {},
        filters: { demandMultiplier: 100 },
      }),
    ).toThrow();
  });
});

import { describe, expect, it } from "vitest";

import { routeNaturalAgentCommand } from "@/application/agent-orchestrator/natural-command-router";

describe("natural-language typed command routing", () => {
  it.each([
    ["Дай оперативную сводку по проекту", "SUMMARY"],
    ["Какие мои задачи требуют решения?", "MY_TASKS"],
    ["Покажи критические риски нехватки на 30 дней", "RISKS"],
    ["Покажи остатки SAP-DEMO-0001 на WH-DEMO-NORTH", "STOCKS"],
    ["Каков текущий остаток материала SAP-DEMO-0001?", "STOCKS"],
    ["Покажи KPI по длительности цикла", "KPI"],
    ["Почему ожидается дефицит по position-portfolio-072-003?", "ANALYSIS"],
  ] as const)("маршрутизирует «%s» в %s", (message, commandKey) => {
    expect(routeNaturalAgentCommand(message, { projectId: "project-1" })).toMatchObject({
      commandKey,
      selection: { projectId: "project-1" },
    });
  });

  it("извлекает позицию и переводит горизонт аналитики из дней в недели", () => {
    expect(routeNaturalAgentCommand(
      "Почему ожидается дефицит по position-portfolio-072-003 на 30 дней?",
      { projectId: "demo-project-001" },
    )).toEqual({
      commandKey: "ANALYSIS",
      selection: { projectId: "demo-project-001" },
      filters: { positionId: "position-portfolio-072-003", horizonWeeks: 5 },
    });
  });

  it("извлекает только типизированные фильтры", () => {
    expect(routeNaturalAgentCommand(
      "Покажи критические риски по материалам на 45 дней",
      { projectId: "project-1" },
    )).toEqual({
      commandKey: "RISKS",
      selection: { projectId: "project-1" },
      filters: { levels: ["CRITICAL"], objectTypes: ["MATERIAL"], horizonDays: 45 },
    });
    expect(routeNaturalAgentCommand(
      "Остатки SAP-DEMO-0001 на WH-DEMO-NORTH и WH-DEMO-SOUTH",
      { projectId: "project-1" },
    )).toEqual({
      commandKey: "STOCKS",
      selection: { projectId: "project-1" },
      filters: {
        materialCode: "SAP-DEMO-0001",
        warehouseIds: ["WH-DEMO-NORTH", "WH-DEMO-SOUTH"],
      },
    });
  });

  it("оставляет неоднозначный экспертный вопрос grounded chat capability", () => {
    expect(routeNaturalAgentCommand("Подбери составной аналог для позиции position-022")).toBeNull();
  });
});

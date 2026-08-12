import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase } from "@/adapters/persistence/db";
import { getRepository } from "@/adapters/persistence/repository";
import { ScenarioService } from "@/application/scenario-service";
import { DEMO_USER_ID, type ScenarioRun } from "@/domain/models";

describe.sequential("ACC-FUNC-001: аналоги для дефицита прямого материала", () => {
  beforeEach(async () => resetDemoDatabase(DEMO_USER_ID));
  afterAll(async () => closeDatabase());

  it("анализирует каждую позицию с недостаточным прямым остатком и сохраняет решение", async () => {
    const repository = await getRepository();
    const service = new ScenarioService(repository);
    const created = await service.createRun(DEMO_USER_ID, {
      scenarioId: "scenario-full-analysis",
      specificationId: "ALL_CURRENT_SPECIFICATIONS",
    });
    const completed = await driveToTerminal(service, created);
    const report = completed.outputSnapshot.report as {
      results: Array<{
        position: { id: string };
        analogueSearch?: {
          directCoveredQuantity: number;
          shortageQuantity: number;
          outcome: string;
        };
        analogueCoverage?: {
          directCoveredQuantity?: number;
          requiredQuantity: number;
          coveredQuantity: number;
        };
      }>;
    };

    for (const [positionId, directCoveredQuantity, shortageQuantity] of [
      ["position-009", 60, 20],
      ["position-012", 2, 4],
      ["position-016", 7, 3],
      ["position-018", 1, 1],
    ] as const) {
      expect(report.results.find((result) => result.position.id === positionId)).toMatchObject({
        analogueSearch: { directCoveredQuantity, shortageQuantity },
      });
    }

    expect(report.results.find((result) => result.position.id === "position-018")).toMatchObject({
      status: "INSUFFICIENT",
      analogueSearch: {
        directCoveredQuantity: 1,
        shortageQuantity: 1,
        outcome: "NO_ELIGIBLE_CANDIDATE",
      },
    });

    const persisted = await repository.listAnalysisResults(DEMO_USER_ID, completed.id);
    expect(persisted.find((result) => result.positionId === "position-009")?.result).toMatchObject({
      analogueSearch: { directCoveredQuantity: 60, shortageQuantity: 20 },
    });
  });
});

async function driveToTerminal(service: ScenarioService, initial: ScenarioRun): Promise<ScenarioRun> {
  let run = initial;
  for (let index = 0; index < 12 && run.status !== "COMPLETED"; index += 1) {
    run = await service.advance(DEMO_USER_ID, run.id, run.version);
  }
  expect(run.status).toBe("COMPLETED");
  return run;
}

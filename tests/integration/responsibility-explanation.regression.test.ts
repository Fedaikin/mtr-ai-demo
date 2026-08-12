import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase } from "@/adapters/persistence/db";
import { getRepository } from "@/adapters/persistence/repository";
import { ScenarioService } from "@/application/scenario-service";
import { DEMO_USER_ID, type ScenarioRun } from "@/domain/models";

describe.sequential("ACC-FUNC-003: обоснование ответственности", () => {
  beforeEach(async () => resetDemoDatabase(DEMO_USER_ID));
  afterAll(async () => closeDatabase());

  it("сохраняет объяснение для каждой из 24 позиций в отчёте и базе", async () => {
    const repository = await getRepository();
    const service = new ScenarioService(repository);
    const created = await service.createRun(DEMO_USER_ID, {
      scenarioId: "scenario-full-analysis",
      specificationId: "ALL_CURRENT_SPECIFICATIONS",
    });
    const completed = await driveToTerminal(service, created);
    const report = completed.outputSnapshot.report as {
      results: Array<{ responsibilityExplanation?: string }>;
    };

    expect(report.results).toHaveLength(24);
    expect(report.results.every((result) => Boolean(result.responsibilityExplanation?.trim()))).toBe(true);

    const persisted = await repository.listAnalysisResults(DEMO_USER_ID, completed.id);
    expect(persisted).toHaveLength(24);
    expect(
      persisted.every((result) => typeof result.result.responsibilityExplanation === "string"),
    ).toBe(true);
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

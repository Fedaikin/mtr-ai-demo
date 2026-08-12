import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase } from "@/adapters/persistence/db";
import { getRepository } from "@/adapters/persistence/repository";
import { ScenarioService } from "@/application/scenario-service";
import { DEMO_USER_ID, type ScenarioRun } from "@/domain/models";

describe.sequential("ACC-FUNC-007: устаревший снимок SAP", () => {
  beforeEach(async () => resetDemoDatabase(DEMO_USER_ID));
  afterAll(async () => closeDatabase());

  it("сохраняет timestamp, warning, fallback и аудит STALE-снимка", async () => {
    const repository = await getRepository();
    const snapshotAt = "2025-01-15T09:00:00.000Z";
    await repository.setIntegrationState(DEMO_USER_ID, "SAP", {
      state: "STALE",
      snapshotAt,
      safeMessage: "Демонстрационный снимок SAP требует проверки актуальности.",
    });
    const service = new ScenarioService(repository);
    const created = await service.createRun(DEMO_USER_ID, {
      scenarioId: "scenario-full-analysis",
      specificationId: "ALL_CURRENT_SPECIFICATIONS",
    });
    const completed = await driveToTerminal(service, created);

    expect(completed.outputSnapshot.sap).toMatchObject({
      state: "STALE",
      snapshotAt,
      freshness: {
        status: "STALE",
        snapshotAt,
        fallbackPolicy: "LAST_KNOWN_SNAPSHOT",
        warning: "Демонстрационный снимок SAP требует проверки актуальности.",
      },
      warnings: ["Демонстрационный снимок SAP требует проверки актуальности."],
    });
    await expect(
      repository.listAuditLogs(DEMO_USER_ID, { action: "SCENARIO_SAP_STALE_SNAPSHOT_USED" }),
    ).resolves.toHaveLength(1);
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

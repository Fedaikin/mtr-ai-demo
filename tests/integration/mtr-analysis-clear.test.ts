import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase } from "@/adapters/persistence/db";
import { getRepository, type MtrRepository } from "@/adapters/persistence/repository";
import { DEMO_USER_DISPLAY_NAME, DEMO_USER_ID } from "@/domain/models";

describe.sequential("MTR analysis clear marker", () => {
  let repository: MtrRepository;
  const projectId = "demo-project-001";

  beforeEach(async () => {
    await resetDemoDatabase(DEMO_USER_ID);
    repository = await getRepository();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("hides the completed run idempotently without deleting its results", async () => {
    const [scenario] = await repository.listScenarios(DEMO_USER_ID, true);
    const [specification] = await repository.listSpecifications(DEMO_USER_ID);
    expect(scenario).toBeTruthy();
    expect(specification).toBeTruthy();
    const latest = await repository.createRun(DEMO_USER_ID, {
      id: "run-mtr-analysis-clear",
      scenarioId: scenario!.id,
      specificationId: specification!.id,
      status: "COMPLETED",
      currentStep: "COMPLETED",
      progress: 100,
      completedAt: "2026-08-15T12:00:00.000Z",
    });
    const resultsBefore = await repository.listAnalysisResults(DEMO_USER_ID, latest.id);

    const first = await repository.clearAnalysisView(DEMO_USER_ID, projectId, latest.id, DEMO_USER_DISPLAY_NAME, 1, "request-clear-1");
    const second = await repository.clearAnalysisView(DEMO_USER_ID, projectId, latest.id, DEMO_USER_DISPLAY_NAME, 1, "request-clear-2");

    expect(first).toEqual(second);
    await expect(repository.isAnalysisViewCleared(DEMO_USER_ID, projectId, latest.id)).resolves.toBe(true);
    await expect(repository.getRun(DEMO_USER_ID, latest.id)).resolves.toMatchObject({ id: latest.id, status: "COMPLETED" });
    await expect(repository.listAnalysisResults(DEMO_USER_ID, latest.id)).resolves.toHaveLength(resultsBefore.length);
    await expect(repository.listAuditLogs(DEMO_USER_ID, {
      action: "ANALYSIS_VIEW_CLEARED",
      entityType: "SCENARIO_RUN",
    })).resolves.toHaveLength(1);
  });

  it("does not mark another user's or unfinished run as cleared", async () => {
    await expect(repository.clearAnalysisView(DEMO_USER_ID, projectId, "missing-run", DEMO_USER_DISPLAY_NAME, 1, "request-missing")).resolves.toBeNull();
    await expect(repository.isAnalysisViewCleared(DEMO_USER_ID, projectId, "missing-run")).resolves.toBe(false);
  });
});

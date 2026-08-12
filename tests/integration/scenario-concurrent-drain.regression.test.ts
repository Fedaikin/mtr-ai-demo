import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import {
  getRepository,
  ScenarioStepClaimInProgressError,
} from "@/adapters/persistence/repository";
import { scenarioRuns, scenarioRunSteps } from "@/adapters/persistence/schema";
import { drainScenarioRun } from "@/application/scenario-runner";
import { ScenarioService } from "@/application/scenario-service";
import { DEMO_USER_ID } from "@/domain/models";

describe.sequential("AT-010: concurrent scenario drains", () => {
  beforeEach(async () => resetDemoDatabase(DEMO_USER_ID));
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => closeDatabase());

  it("converges two workers on one terminal run without duplicate effects", async () => {
    const repository = await getRepository();
    const service = new ScenarioService(repository);
    await repository.setIntegrationState(DEMO_USER_ID, "APPIUS", {
      state: "AVAILABLE",
      // Hold the first claimed step open long enough for a second server
      // instance to observe and contend for the same persisted run.
      delayMs: 75,
    });
    const created = await service.createRun(DEMO_USER_ID, {
      scenarioId: "scenario-full-analysis",
      specificationId: "ALL_CURRENT_SPECIFICATIONS",
    });
    const executeStep = vi.spyOn(
      ScenarioService.prototype as unknown as {
        executeStep: (...args: unknown[]) => Promise<Record<string, unknown>>;
      },
      "executeStep",
    );

    const startedAt = performance.now();
    const drains = await Promise.all([
      drainScenarioRun(DEMO_USER_ID, created.id),
      drainScenarioRun(DEMO_USER_ID, created.id),
    ]);
    const durationMs = performance.now() - startedAt;
    const [persisted, results, steps, stepAudits] = await Promise.all([
      service.getRun(DEMO_USER_ID, created.id),
      repository.listAnalysisResults(DEMO_USER_ID, created.id),
      repository.listScenarioRunSteps(DEMO_USER_ID, created.id),
      repository.listAuditLogs(DEMO_USER_ID, {
        action: "SCENARIO_STEP_COMPLETED",
        limit: 20,
      }),
    ]);
    const runAudits = stepAudits.filter((audit) => audit.entityId === created.id);

    expect(drains.map((drain) => drain.stopReason)).toEqual(["TERMINAL", "TERMINAL"]);
    expect(drains.every((drain) => drain.run.status === "COMPLETED")).toBe(true);
    expect(drains.reduce((total, drain) => total + drain.transitions, 0)).toBe(6);
    expect(executeStep).toHaveBeenCalledTimes(6);
    expect(persisted).toMatchObject({ status: "COMPLETED", progress: 100 });
    expect(results).toHaveLength(24);
    expect(steps).toHaveLength(6);
    expect(steps.every((step) => step.outcome === "COMPLETED")).toBe(true);
    expect(runAudits).toHaveLength(6);
    expect(new Set(runAudits.map((audit) => audit.id)).size).toBe(6);
    expect(durationMs).toBeLessThan(5_000);
  });

  it("does not let a direct concurrent advance steal a fresh step claim", async () => {
    const repository = await getRepository();
    const service = new ScenarioService(repository);
    await repository.setIntegrationState(DEMO_USER_ID, "APPIUS", {
      state: "AVAILABLE",
      delayMs: 250,
    });
    const created = await service.createRun(DEMO_USER_ID, {
      scenarioId: "scenario-full-analysis",
      specificationId: "ALL_CURRENT_SPECIFICATIONS",
    });
    const executeStep = vi.spyOn(
      service as unknown as {
        executeStep: (...args: unknown[]) => Promise<Record<string, unknown>>;
      },
      "executeStep",
    );

    const firstAdvance = service.advance(DEMO_USER_ID, created.id, created.version);
    const claimed = await waitForClaim(service, created.id);

    await expect(
      service.advance(DEMO_USER_ID, created.id, claimed.version),
    ).rejects.toBeInstanceOf(ScenarioStepClaimInProgressError);

    const advanced = await firstAdvance;
    const persisted = await service.getRun(DEMO_USER_ID, created.id);
    expect(advanced.status).toBe("SYNCING_SAP");
    expect(persisted).toMatchObject({ status: "SYNCING_SAP", version: advanced.version });
    expect(persisted.steps).toEqual([
      expect.objectContaining({ status: "LOADING_APPIUS", outcome: "COMPLETED" }),
    ]);
    expect(executeStep).toHaveBeenCalledTimes(1);
  });

  it("takes over a stale persisted step claim after its worker disappears", async () => {
    const repository = await getRepository();
    const service = new ScenarioService(repository);
    const created = await service.createRun(DEMO_USER_ID, {
      scenarioId: "scenario-full-analysis",
      specificationId: "ALL_CURRENT_SPECIFICATIONS",
    });
    const staleStartedAt = new Date(Date.now() - 60_000).toISOString();
    const claimed = await repository.claimScenarioStep(
      DEMO_USER_ID,
      created.id,
      created.version,
      {
        runId: created.id,
        status: "LOADING_APPIUS",
        label: "Загрузка данных Appius PLM",
        outcome: "STARTED",
        startedAt: staleStartedAt,
        idempotencyKey: `${created.id}:LOADING_APPIUS:attempt-1`,
        details: { attemptVersion: created.version + 1 },
        runPatch: {
          status: "LOADING_APPIUS",
          currentStep: "LOADING_APPIUS",
          progress: 10,
          startedAt: staleStartedAt,
        },
      },
    );
    await (await getDatabase())
      .update(scenarioRunSteps)
      .set({ updatedAt: staleStartedAt })
      .where(eq(scenarioRunSteps.id, claimed.step.id));
    await (await getDatabase())
      .update(scenarioRuns)
      .set({ updatedAt: staleStartedAt })
      .where(eq(scenarioRuns.id, created.id));

    const drained = await drainScenarioRun(DEMO_USER_ID, created.id);
    const [persisted, results, steps, stepAudits] = await Promise.all([
      service.getRun(DEMO_USER_ID, created.id),
      repository.listAnalysisResults(DEMO_USER_ID, created.id),
      repository.listScenarioRunSteps(DEMO_USER_ID, created.id),
      repository.listAuditLogs(DEMO_USER_ID, {
        action: "SCENARIO_STEP_COMPLETED",
        limit: 20,
      }),
    ]);
    const runAudits = stepAudits.filter((audit) => audit.entityId === created.id);

    expect(drained).toMatchObject({ stopReason: "TERMINAL", run: { status: "COMPLETED" } });
    expect(persisted).toMatchObject({ status: "COMPLETED", progress: 100 });
    expect(results).toHaveLength(24);
    expect(steps).toHaveLength(6);
    expect(steps.every((step) => step.outcome === "COMPLETED")).toBe(true);
    expect(runAudits).toHaveLength(6);
    expect(new Set(runAudits.map((audit) => audit.id)).size).toBe(6);
  });

  it("waits on a fresh persisted claim and yields at the configured time bound", async () => {
    const repository = await getRepository();
    const service = new ScenarioService(repository);
    const created = await service.createRun(DEMO_USER_ID, {
      scenarioId: "scenario-full-analysis",
      specificationId: "ALL_CURRENT_SPECIFICATIONS",
    });
    const startedAt = new Date().toISOString();
    const claimed = await repository.claimScenarioStep(
      DEMO_USER_ID,
      created.id,
      created.version,
      {
        runId: created.id,
        status: "LOADING_APPIUS",
        label: "Загрузка данных Appius PLM",
        outcome: "STARTED",
        startedAt,
        idempotencyKey: `${created.id}:LOADING_APPIUS:attempt-1`,
        details: { attemptVersion: created.version + 1 },
        runPatch: {
          status: "LOADING_APPIUS",
          currentStep: "LOADING_APPIUS",
          progress: 10,
          startedAt,
        },
      },
    );

    const drained = await drainScenarioRun(DEMO_USER_ID, created.id, { maxDurationMs: 100 });
    const persisted = await service.getRun(DEMO_USER_ID, created.id);

    expect(drained).toMatchObject({
      stopReason: "TIME_LIMIT",
      transitions: 0,
      conflicts: 0,
      run: { status: "LOADING_APPIUS", version: claimed.run.version },
    });
    expect(persisted).toMatchObject({
      status: "LOADING_APPIUS",
      version: claimed.run.version,
      steps: [expect.objectContaining({ outcome: "STARTED" })],
    });
  });
});

async function waitForClaim(service: ScenarioService, runId: string): Promise<Awaited<ReturnType<ScenarioService["getRun"]>>> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const run = await service.getRun(DEMO_USER_ID, runId);
    if (run.steps.some((step) => step.outcome === "STARTED")) return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Fresh scenario claim was not persisted within the test deadline.");
}

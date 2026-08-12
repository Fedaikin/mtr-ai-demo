import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { OptimisticLockError } from "@/adapters/persistence/repository";
import {
  drainScenarioRunWithDriver,
  type ScenarioRunDriver,
} from "@/application/scenario-runner";
import type { ScenarioRun, ScenarioRunStatus } from "@/domain/models";

describe("bounded server scenario drain", () => {
  it("advances without a browser until the run is terminal", async () => {
    const driver = sequenceDriver(["QUEUED", "LOADING_APPIUS", "SYNCING_SAP", "COMPLETED"]);
    const advance = vi.spyOn(driver, "advance");

    const result = await drainScenarioRunWithDriver(driver, "demo-user-001", "run-unit");

    expect(result).toMatchObject({
      stopReason: "TERMINAL",
      transitions: 3,
      conflicts: 0,
      run: { status: "COMPLETED", version: 4 },
    });
    expect(advance).toHaveBeenNthCalledWith(
      1,
      "demo-user-001",
      "run-unit",
      1,
      expect.objectContaining({ status: "QUEUED", version: 1 }),
    );
    expect(advance).toHaveBeenNthCalledWith(
      2,
      "demo-user-001",
      "run-unit",
      2,
      expect.objectContaining({ status: "LOADING_APPIUS", version: 2 }),
    );
  });

  it("refetches after a CAS conflict and never overwrites the competing state", async () => {
    let current = run("QUEUED", 1);
    let firstAdvance = true;
    const driver: ScenarioRunDriver = {
      async getRun() {
        return structuredClone(current);
      },
      async advance() {
        if (firstAdvance) {
          firstAdvance = false;
          current = run("SYNCING_SAP", 2);
          throw new OptimisticLockError(current.id);
        }
        current = run("CANCELLED", 3);
        return structuredClone(current);
      },
    };

    const result = await drainScenarioRunWithDriver(driver, "demo-user-001", current.id);

    expect(result).toMatchObject({
      stopReason: "TERMINAL",
      transitions: 1,
      conflicts: 1,
      run: { status: "CANCELLED", version: 3 },
    });
  });

  it("yields at the configured transition bound instead of looping forever", async () => {
    let current = run("QUEUED", 1);
    const driver: ScenarioRunDriver = {
      async getRun() {
        return structuredClone(current);
      },
      async advance() {
        current = run("LOADING_APPIUS", current.version + 1);
        return structuredClone(current);
      },
    };

    const result = await drainScenarioRunWithDriver(driver, "demo-user-001", current.id, {
      maxTransitions: 2,
    });

    expect(result).toMatchObject({
      stopReason: "TRANSITION_LIMIT",
      transitions: 2,
      run: { status: "LOADING_APPIUS", version: 3 },
    });
  });

  it("does not advance an already terminal run", async () => {
    const advance = vi.fn<ScenarioRunDriver["advance"]>();
    const driver: ScenarioRunDriver = {
      async getRun() {
        return run("FAILED", 7);
      },
      advance,
    };

    const result = await drainScenarioRunWithDriver(driver, "demo-user-001", "run-unit");

    expect(result.stopReason).toBe("TERMINAL");
    expect(result.transitions).toBe(0);
    expect(advance).not.toHaveBeenCalled();
  });
});

function sequenceDriver(statuses: ScenarioRunStatus[]): ScenarioRunDriver {
  let index = 0;
  return {
    async getRun() {
      return run(statuses[index] ?? "COMPLETED", index + 1);
    },
    async advance() {
      index = Math.min(index + 1, statuses.length - 1);
      return run(statuses[index] ?? "COMPLETED", index + 1);
    },
  };
}

function run(status: ScenarioRunStatus, version: number): ScenarioRun {
  const timestamp = "2026-08-12T00:00:00.000Z";
  return {
    id: "run-unit",
    userId: "demo-user-001",
    scenarioId: "scenario-full-analysis",
    specificationId: "spec-demo-piping-001",
    status,
    currentStep: status,
    progress: ["COMPLETED", "FAILED", "CANCELLED"].includes(status) ? 100 : 0,
    mode: "NORMAL",
    seed: "BASE",
    version,
    createdAt: timestamp,
    updatedAt: timestamp,
    inputSnapshot: {},
    outputSnapshot: {},
    steps: [],
  };
}

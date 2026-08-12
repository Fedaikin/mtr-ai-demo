import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => Promise<void> | void>,
  drainScenarioRun: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  after: vi.fn((callback: () => Promise<void> | void) => {
    mocks.afterCallbacks.push(callback);
  }),
}));
vi.mock("@/application/scenario-runner", () => ({
  drainScenarioRun: mocks.drainScenarioRun,
}));
vi.mock("@/adapters/persistence/repository", () => ({
  getRepository: vi.fn(async () => ({ writeAudit: mocks.writeAudit })),
}));

import {
  executeScheduledScenarioRunDrain,
  scheduleScenarioRunDrain,
} from "@/application/scenario-background";

describe("scenario background scheduling", () => {
  beforeEach(() => {
    mocks.afterCallbacks.length = 0;
    mocks.drainScenarioRun.mockReset();
    mocks.writeAudit.mockReset();
  });

  it("registers the server drain for after-response execution without starting it inline", async () => {
    mocks.drainScenarioRun.mockResolvedValue(terminalDrain());

    scheduleScenarioRunDrain("demo-user-001", "run-background-deferred");

    expect(mocks.afterCallbacks).toHaveLength(1);
    expect(mocks.drainScenarioRun).not.toHaveBeenCalled();

    await mocks.afterCallbacks[0]!();

    expect(mocks.drainScenarioRun).toHaveBeenCalledWith(
      "demo-user-001",
      "run-background-deferred",
    );
  });

  it("deduplicates repeated scheduling within one server instance", () => {
    scheduleScenarioRunDrain("demo-user-001", "run-background-deduplicated");
    scheduleScenarioRunDrain("demo-user-001", "run-background-deduplicated");

    expect(mocks.afterCallbacks).toHaveLength(1);
  });

  it("records a safe audit when a bounded drain yields non-terminal", async () => {
    mocks.drainScenarioRun.mockResolvedValue({
      ...terminalDrain(),
      stopReason: "TIME_LIMIT",
      run: { id: "run-background-yield", status: "SYNCING_SAP", version: 4 },
    });

    await executeScheduledScenarioRunDrain("demo-user-001", "run-background-yield");

    expect(mocks.writeAudit).toHaveBeenCalledWith("demo-user-001", expect.objectContaining({
      action: "SCENARIO_DRAIN_YIELDED",
      entityId: "run-background-yield",
      outcome: "SUCCESS",
      details: expect.objectContaining({ stopReason: "TIME_LIMIT", status: "SYNCING_SAP" }),
    }));
  });

  it("contains an unexpected drain failure and persists only its safe type", async () => {
    mocks.drainScenarioRun.mockRejectedValue(new TypeError("private database address"));

    await expect(
      executeScheduledScenarioRunDrain("demo-user-001", "run-background-failed"),
    ).resolves.toBeUndefined();

    expect(mocks.writeAudit).toHaveBeenCalledWith("demo-user-001", expect.objectContaining({
      action: "SCENARIO_DRAIN_FAILED",
      outcome: "FAILURE",
      details: { errorCode: "BACKGROUND_DRAIN_FAILED", errorType: "TypeError" },
    }));
    expect(JSON.stringify(mocks.writeAudit.mock.calls)).not.toContain("private database address");
  });
});

function terminalDrain() {
  return {
    transitions: 6,
    conflicts: 0,
    stopReason: "TERMINAL",
    run: { id: "run-background", status: "COMPLETED", version: 7 },
  };
}

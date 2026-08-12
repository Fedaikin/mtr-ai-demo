import "server-only";

import { after } from "next/server";

import { getRepository } from "@/adapters/persistence/repository";
import { drainScenarioRun } from "@/application/scenario-runner";

const SCHEDULE_GUARD_MS = 25_000;
const globalState = globalThis as typeof globalThis & {
  __mtrScenarioDrainSchedule?: Map<string, number>;
};
const scheduledUntil = (globalState.__mtrScenarioDrainSchedule ??= new Map());

export function scheduleScenarioRunDrain(userId: string, runId: string): void {
  const key = `${userId}:${runId}`;
  const now = Date.now();
  const existing = scheduledUntil.get(key) ?? 0;
  if (existing > now) return;
  const guardUntil = now + SCHEDULE_GUARD_MS;
  scheduledUntil.set(key, guardUntil);
  try {
    after(async () => {
      try {
        await executeScheduledScenarioRunDrain(userId, runId);
      } finally {
        if (scheduledUntil.get(key) === guardUntil) scheduledUntil.delete(key);
      }
    });
  } catch (error) {
    if (scheduledUntil.get(key) === guardUntil) scheduledUntil.delete(key);
    throw error;
  }
}

export async function executeScheduledScenarioRunDrain(
  userId: string,
  runId: string,
): Promise<void> {
  try {
    const result = await drainScenarioRun(userId, runId);
    if (result.stopReason !== "TERMINAL") {
      await writeDrainAudit(userId, runId, "SCENARIO_DRAIN_YIELDED", "SUCCESS", {
        stopReason: result.stopReason,
        transitions: result.transitions,
        conflicts: result.conflicts,
        status: result.run.status,
        version: result.run.version,
      });
    }
  } catch (error) {
    await writeDrainAudit(userId, runId, "SCENARIO_DRAIN_FAILED", "FAILURE", {
      errorCode: "BACKGROUND_DRAIN_FAILED",
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

async function writeDrainAudit(
  userId: string,
  runId: string,
  action: string,
  outcome: "SUCCESS" | "FAILURE",
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await (await getRepository()).writeAudit(userId, {
      action,
      entityType: "SCENARIO_RUN",
      entityId: runId,
      outcome,
      details,
    });
  } catch {
    // The original persistence error is intentionally not rethrown from after().
  }
}

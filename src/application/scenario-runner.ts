import "server-only";

import {
  getRepository,
  OptimisticLockError,
  SCENARIO_STEP_CLAIM_LEASE_MS,
  ScenarioStepClaimInProgressError,
} from "@/adapters/persistence/repository";
import { ScenarioService } from "@/application/scenario-service";
import type { ScenarioRun } from "@/domain/models";
import { TERMINAL_STATUSES } from "@/domain/scenario";

const DEFAULT_MAX_TRANSITIONS = 8;
const DEFAULT_MAX_ATTEMPTS = 24;
const DEFAULT_MAX_DURATION_MS = 20_000;
const ACTIVE_CLAIM_POLL_MS = 50;

export type ScenarioDrainStopReason =
  | "TERMINAL"
  | "TRANSITION_LIMIT"
  | "ATTEMPT_LIMIT"
  | "TIME_LIMIT";

export interface ScenarioDrainResult {
  run: ScenarioRun;
  transitions: number;
  conflicts: number;
  stopReason: ScenarioDrainStopReason;
}

export interface ScenarioRunDriver {
  getRun(userId: string, runId: string): Promise<ScenarioRun>;
  advance(
    userId: string,
    runId: string,
    expectedVersion?: number,
    currentRun?: ScenarioRun,
  ): Promise<ScenarioRun>;
}

export interface ScenarioDrainOptions {
  maxTransitions?: number;
  maxAttempts?: number;
  maxDurationMs?: number;
  now?: () => number;
}

export async function drainScenarioRun(
  userId: string,
  runId: string,
  options: ScenarioDrainOptions = {},
): Promise<ScenarioDrainResult> {
  const repository = await getRepository();
  const service = new ScenarioService(repository);
  return drainScenarioRunWithDriver(service, userId, runId, options);
}

export async function drainScenarioRunWithDriver(
  driver: ScenarioRunDriver,
  userId: string,
  runId: string,
  options: ScenarioDrainOptions = {},
): Promise<ScenarioDrainResult> {
  const maxTransitions = positiveInteger(options.maxTransitions, DEFAULT_MAX_TRANSITIONS);
  const maxAttempts = positiveInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS);
  const maxDurationMs = positiveInteger(options.maxDurationMs, DEFAULT_MAX_DURATION_MS);
  const now = options.now ?? Date.now;
  const startedAt = now();
  const wallStartedAt = Date.now();
  let transitions = 0;
  let conflicts = 0;
  let attempts = 0;
  let run = await driver.getRun(userId, runId);

  while (!TERMINAL_STATUSES.has(run.status)) {
    if (transitions >= maxTransitions) {
      return { run, transitions, conflicts, stopReason: "TRANSITION_LIMIT" };
    }
    if (attempts >= maxAttempts) {
      return { run, transitions, conflicts, stopReason: "ATTEMPT_LIMIT" };
    }
    const elapsedMs = Math.max(now() - startedAt, Date.now() - wallStartedAt);
    if (elapsedMs >= maxDurationMs) {
      return { run, transitions, conflicts, stopReason: "TIME_LIMIT" };
    }

    // A different server instance may already own this persisted step claim.
    // Observe its CAS-protected progress instead of bumping the same status and
    // invalidating the owner's completion. A stale claim is deliberately not
    // waited on, so a later drain can recover work abandoned by a crashed owner.
    if (hasFreshActiveClaim(run, now())) {
      await wait(Math.min(ACTIVE_CLAIM_POLL_MS, maxDurationMs - elapsedMs));
      run = await driver.getRun(userId, runId);
      continue;
    }

    attempts += 1;
    try {
      run = await driver.advance(userId, runId, run.version, run);
      transitions += 1;
    } catch (error) {
      if (!(error instanceof OptimisticLockError)) throw error;
      conflicts += 1;
      run = await driver.getRun(userId, runId);
      // The repository uses this subtype when the CAS state itself is still
      // current but its fresh STARTED row belongs to another worker. Observe
      // that durable claim before trying to take over again.
      if (error instanceof ScenarioStepClaimInProgressError && hasFreshActiveClaim(run, now())) {
        const conflictElapsedMs = Math.max(now() - startedAt, Date.now() - wallStartedAt);
        if (conflictElapsedMs < maxDurationMs) {
          await wait(Math.min(ACTIVE_CLAIM_POLL_MS, maxDurationMs - conflictElapsedMs));
          run = await driver.getRun(userId, runId);
        }
      }
    }
  }

  return { run, transitions, conflicts, stopReason: "TERMINAL" };
}

function hasFreshActiveClaim(run: ScenarioRun, observedAt: number): boolean {
  const activeStep = run.steps
    .filter((step) =>
      step.status === run.status &&
      step.outcome === "STARTED"
    )
    .toSorted((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))[0];
  if (!activeStep) return false;

  const attemptVersion = activeStep.details?.attemptVersion;
  if (attemptVersion !== run.version) return false;
  const activityAt = Math.max(Date.parse(activeStep.startedAt), Date.parse(run.updatedAt));
  return Number.isFinite(activityAt) && observedAt - activityAt < SCENARIO_STEP_CLAIM_LEASE_MS;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, delayMs)));
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.trunc(value));
}

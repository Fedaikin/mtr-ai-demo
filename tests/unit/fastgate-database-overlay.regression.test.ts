import { describe, expect, it } from "vitest";

import { buildDatabaseOverlayPlan } from "@/evals/fastgate/official/database-overlay";

describe("official FastGate database counterfactual plan", () => {
  it("детерминирован для одного seed, меняет факты между прогонами и покрывает обязательные cases", () => {
    const first = buildDatabaseOverlayPlan({
      seed: "a".repeat(64),
      scenarioInstant: "2026-08-14T12:00:00.000Z",
    });
    const repeated = buildDatabaseOverlayPlan({
      seed: "a".repeat(64),
      scenarioInstant: "2026-08-14T12:00:00.000Z",
    });
    const second = buildDatabaseOverlayPlan({
      seed: "b".repeat(64),
      scenarioInstant: "2026-08-14T12:00:00.000Z",
    });

    expect(first).toEqual(repeated);
    expect(first.planSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.planSha256).not.toBe(second.planSha256);
    expect(first.seedCommitmentSha256).not.toBe("a".repeat(64));
    expect(first.mutationIds).toEqual([
      "FG-02_PROJECT_STATE",
      "FG-03_STOCK_SNAPSHOT",
      "FG-04_REQUIRED_COVERAGE",
      "FG-05_INTAKE_STATUS",
      "FG-06_DEADLINE_WINDOW",
      "FG-07_COMPATIBILITY_SOURCE",
      "FG-08_RULE_VERSION",
      "FG-09_SOURCE_CONFLICT_MARKER",
      "FG-11_WAREHOUSE_SCOPE_SOURCE",
    ]);
  });

  it("отклоняет невалидный seed и время", () => {
    expect(() => buildDatabaseOverlayPlan({ seed: "short", scenarioInstant: "2026-08-14T12:00:00Z" }))
      .toThrow("INVALID_DATABASE_OVERLAY_SEED");
    expect(() => buildDatabaseOverlayPlan({ seed: "c".repeat(64), scenarioInstant: "not-a-date" }))
      .toThrow("INVALID_DATABASE_OVERLAY_INSTANT");
  });
});

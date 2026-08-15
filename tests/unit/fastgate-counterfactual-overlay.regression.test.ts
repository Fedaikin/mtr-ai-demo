import {
  buildCounterfactualOverlay,
  projectOverlayForApplication,
  validateCounterfactualCoverage,
} from "@/evals/fastgate/official/counterfactual-overlay";

describe("official FastGate counterfactual overlay", () => {
  it("is deterministic per seed, changes across seeds, and covers mandatory cases", () => {
    const first = buildCounterfactualOverlay({ seed: "a".repeat(64), runId: "run-a", runNonce: "1".repeat(64) });
    const repeated = buildCounterfactualOverlay({ seed: "a".repeat(64), runId: "run-a", runNonce: "1".repeat(64) });
    const second = buildCounterfactualOverlay({ seed: "b".repeat(64), runId: "run-b", runNonce: "2".repeat(64) });

    expect(first).toEqual(repeated);
    expect(first.datasetFingerprint).not.toBe(second.datasetFingerprint);
    expect(validateCounterfactualCoverage(first)).toEqual({ valid: true, missing: [] });
    expect(first.coveredCases).toEqual(expect.arrayContaining(["FG-02", "FG-03", "FG-04", "FG-05", "FG-06", "FG-07", "FG-08", "FG-09", "FG-11"]));
  });

  it("does not expose expected answers, oracle rows, or proof hashes to the app", () => {
    const overlay = buildCounterfactualOverlay({ seed: "c".repeat(64), runId: "run-c", runNonce: "3".repeat(64) });
    const publicProjection = projectOverlayForApplication(overlay);
    const serialized = JSON.stringify(publicProjection);

    expect(serialized).not.toMatch(/expected|oracle|proofId|sourceRowHashes|resultHash/iu);
    expect(publicProjection.datasetVersion).toBe(overlay.datasetVersion);
    expect(publicProjection.overlaySeed).toBe(overlay.seed);
    expect(publicProjection.scenarioInstant).toBe("2026-08-14T12:00:00.000Z");
    expect(publicProjection.publicFixture).toBeDefined();
  });

  it("has referentially valid sources and an intentional contradiction", () => {
    const overlay = buildCounterfactualOverlay({ seed: "d".repeat(64), runId: "run-d", runNonce: "4".repeat(64) });
    const sourceIds = new Set(overlay.privateProofIndex.flatMap((proof) => proof.sourceRowIds));
    expect(sourceIds.size).toBeGreaterThan(0);
    expect([...sourceIds].every((id) => overlay.sourceRows.some((row) => row.id === id))).toBe(true);
    expect(overlay.privateProofIndex.some((proof) => proof.expectedDisposition === "HUMAN_REVIEW_CONFLICT")).toBe(true);
  });
});

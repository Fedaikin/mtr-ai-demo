import { verifyOfficialFastGateAggregate } from "@/evals/fastgate/official/verifier";

describe("offline official FastGate verifier", () => {
  it("accepts only three HIGH runs with minimum 93 and median at least 95", () => {
    const aggregate = validAggregate();
    expect(verifyOfficialFastGateAggregate(aggregate)).toMatchObject({
      valid: true,
      verdict: "PASS",
      minimumAcceptanceReadiness: 93,
      medianAcceptanceReadiness: 96,
    });
  });

  it.each([
    ["two runs", (value: ReturnType<typeof validAggregate>) => ({ ...value, runs: value.runs.slice(0, 2) })],
    ["duplicate seed", (value: ReturnType<typeof validAggregate>) => ({
      ...value,
      runs: value.runs.map((run, index) => index === 2 ? { ...run, seed: value.runs[0]!.seed } : run),
    })],
    ["sha mismatch", (value: ReturnType<typeof validAggregate>) => ({
      ...value,
      runs: value.runs.map((run, index) => index === 1 ? { ...run, deploymentSha: "f".repeat(40) } : run),
    })],
    ["missing message", (value: ReturnType<typeof validAggregate>) => ({
      ...value,
      runs: value.runs.map((run, index) => index === 0 ? { ...run, agentMessageCount: 22 } : run),
    })],
    ["missing case", (value: ReturnType<typeof validAggregate>) => ({
      ...value,
      runs: value.runs.map((run, index) => index === 0 ? { ...run, passedCaseCount: 11 } : run),
    })],
    ["witness false", (value: ReturnType<typeof validAggregate>) => ({
      ...value,
      runs: value.runs.map((run, index) => index === 0 ? { ...run, independentConnectorWitnessVerified: false } : run),
    })],
    ["database mutation witness false", (value: ReturnType<typeof validAggregate>) => ({
      ...value,
      runs: value.runs.map((run, index) => index === 0 ? { ...run, databaseMutationVerified: false } : run),
    })],
    ["diagnostic signature false", (value: ReturnType<typeof validAggregate>) => ({
      ...value,
      runs: value.runs.map((run, index) => index === 0 ? { ...run, diagnosticSignatureVerified: false } : run),
    })],
    ["minimum below 93", (value: ReturnType<typeof validAggregate>) => ({
      ...value,
      runs: value.runs.map((run, index) => index === 0 ? { ...run, acceptanceReadinessScore: 92 } : run),
    })],
    ["confidence not high", (value: ReturnType<typeof validAggregate>) => ({
      ...value,
      runs: value.runs.map((run, index) => index === 0 ? { ...run, assessmentConfidence: "MEDIUM" as const } : run),
    })],
    ["security gate missing", (value: ReturnType<typeof validAggregate>) => ({ ...value, security: { ...value.security, passedSessions: 9 } })],
    ["load gate missing", (value: ReturnType<typeof validAggregate>) => ({ ...value, load: { ...value.load, completedSessions: 49 } })],
    ["load sessions are not unique", (value: ReturnType<typeof validAggregate>) => ({
      ...value,
      loadRuns: value.loadRuns.map((load, index) => index === 0 ? { ...load, uniqueAuthenticatedSessions: 49 } : load),
    })],
    ["unsafe artifact path", (value: ReturnType<typeof validAggregate>) => ({
      ...value,
      artifactFiles: [{ ...value.artifactFiles[0]!, path: "../escape" }],
    })],
  ])("rejects %s", (_label, mutate) => {
    expect(verifyOfficialFastGateAggregate(mutate(validAggregate())).valid).toBe(false);
  });

  function validAggregate() {
    const common = {
      deploymentSha: "a".repeat(40),
      sourceTreeSha256: "b".repeat(64),
      lockfileSha256: "c".repeat(64),
      manifestSha256: "d".repeat(64),
      evaluatorSha256: "e".repeat(64),
      oracleSha256: "1".repeat(64),
      applicationImageDigest: `sha256:${"2".repeat(64)}`,
      witnessImageDigest: `sha256:${"3".repeat(64)}`,
      proxyImageDigest: `sha256:${"4".repeat(64)}`,
      verifierImageDigest: `sha256:${"5".repeat(64)}`,
      supervisorImageDigest: `sha256:${"f".repeat(64)}`,
      assessmentConfidence: "HIGH" as const,
      agentMessageCount: 23,
      passedCaseCount: 12,
      rawScore: 100,
      verifiedCapabilityPercent: 100,
      evaluationCoveragePercent: 100,
      diagnosticSignatureVerified: true,
      independentConnectorWitnessVerified: true,
      signedHttpTranscriptVerified: true,
      runtimeAttestationVerified: true,
      counterfactualWitnessVerified: true,
      sourceBindingVerified: true,
      cleanupVerified: true,
      databaseMutationVerified: true,
      appliedCaps: [] as const,
      criticalBlockers: [] as const,
    };
    return {
      schemaVersion: "mtr-agent-fastgate-official-aggregate-v1" as const,
      generatedAt: "2026-08-14T12:00:00.000Z",
      runs: [
        { ...common, runId: "run-1", seed: "6".repeat(64), acceptanceReadinessScore: 93 },
        { ...common, runId: "run-2", seed: "7".repeat(64), acceptanceReadinessScore: 96 },
        { ...common, runId: "run-3", seed: "8".repeat(64), acceptanceReadinessScore: 100 },
      ],
      security: { requestedSessions: 10, passedSessions: 10, leaks: 0, violations: 0 },
      load: loadGate(),
      securityRuns: Array.from({ length: 3 }, () => ({ requestedSessions: 10, passedSessions: 10, leaks: 0, violations: 0 })),
      loadRuns: Array.from({ length: 3 }, () => loadGate()),
      artifactFiles: [{ path: "run-1/run-evidence.json", bytes: 100, sha256: "a".repeat(64) }],
      independentReview: {
        valid: true,
        reviewerRole: "READ_ONLY_REVIEWER",
        artifactSha256: "9".repeat(64),
        inputCommitmentSha256: "0".repeat(64),
        finalSha: "a".repeat(40),
      },
    };
  }

  function loadGate() {
    return {
      requestedSessions: 50,
      authenticatedSessions: 50,
      uniqueAuthenticatedSessions: 50,
      completedSessions: 50,
      errors: 0,
      p95Ms: 4_500,
      serviceP95Ms: 1_000,
      authenticationSetupP95Ms: 1_000,
      queueWaitP95Ms: 3_500,
      maxInFlightRequests: 10,
      limitMs: 5_000,
    };
  }
});

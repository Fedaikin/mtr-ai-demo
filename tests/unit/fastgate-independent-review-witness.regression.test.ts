import {
  createIndependentReviewWitnessSigner,
  parseCodexReviewJsonl,
  verifyIndependentReviewWitnessEnvelope,
} from "@/evals/fastgate/official/reviewer-witness";

describe("independent reviewer-origin witness", () => {
  it("binds the actual Codex session transcript and final JSON with a reviewer-only key", () => {
    const transcript = [
      JSON.stringify({ type: "thread.started", thread_id: "review-thread-1" }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify({ findings: { P0: 0, P1: 0, P2: 0, P3: 0 }, verdict: "PASS", summary: "clean" }) } }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } }),
    ].join("\n");
    const parsed = parseCodexReviewJsonl(transcript);
    const signer = createIndependentReviewWitnessSigner({
      finalSha: "a".repeat(40),
      sourceTreeSha256: "b".repeat(64),
      witnessScriptSha256: "c".repeat(64),
      issuedAt: "2026-08-15T00:00:00.000Z",
    });
    const envelope = signer.sign({
      inputCommitmentSha256: "d".repeat(64),
      codexExecutableSha256: "e".repeat(64),
      codexExecutablePinSha256: "e".repeat(64),
      codexExecutablePinSource: "EXTERNAL_USER_TRUST_STORE",
      codexVersion: "codex-cli-test",
      commandArgvSha256: "f".repeat(64),
      startedAt: "2026-08-15T00:00:01.000Z",
      finishedAt: "2026-08-15T00:00:02.000Z",
      exitStatus: 0,
      stdoutSha256: hashLike(transcript),
      stderrSha256: "1".repeat(64),
      reviewerSessionIdHash: hashLike(parsed.threadId),
      outputSha256: hashLike(parsed.outputText),
      findings: parsed.output.findings,
      verdict: parsed.output.verdict,
    });

    expect(verifyIndependentReviewWitnessEnvelope(envelope, {
      finalSha: "a".repeat(40),
      sourceTreeSha256: "b".repeat(64),
      witnessScriptSha256: "c".repeat(64),
      inputCommitmentSha256: "d".repeat(64),
      stdoutSha256: hashLike(transcript),
      outputSha256: hashLike(parsed.outputText),
      codexExecutablePinSha256: "e".repeat(64),
    })).toBe(true);
    expect(parsed.threadId).toBe("review-thread-1");
  });

  it("rejects transcript or verdict substitution by the host runner", () => {
    const signer = createIndependentReviewWitnessSigner({
      finalSha: "a".repeat(40),
      sourceTreeSha256: "b".repeat(64),
      witnessScriptSha256: "c".repeat(64),
      issuedAt: "2026-08-15T00:00:00.000Z",
    });
    const envelope = signer.sign({
      inputCommitmentSha256: "d".repeat(64),
      codexExecutableSha256: "e".repeat(64),
      codexExecutablePinSha256: "e".repeat(64),
      codexExecutablePinSource: "EXTERNAL_USER_TRUST_STORE",
      codexVersion: "codex-cli-test",
      commandArgvSha256: "f".repeat(64),
      startedAt: "2026-08-15T00:00:01.000Z",
      finishedAt: "2026-08-15T00:00:02.000Z",
      exitStatus: 0,
      stdoutSha256: "0".repeat(64),
      stderrSha256: "1".repeat(64),
      reviewerSessionIdHash: "2".repeat(64),
      outputSha256: "3".repeat(64),
      findings: { P0: 0, P1: 0, P2: 0, P3: 0 },
      verdict: "PASS",
    });
    const tampered = { ...envelope, payload: { ...envelope.payload, verdict: "FAIL" as const } };
    expect(verifyIndependentReviewWitnessEnvelope(tampered, {
      finalSha: "a".repeat(40),
      sourceTreeSha256: "b".repeat(64),
      witnessScriptSha256: "c".repeat(64),
      inputCommitmentSha256: "d".repeat(64),
      stdoutSha256: "0".repeat(64),
      outputSha256: "3".repeat(64),
      codexExecutablePinSha256: "e".repeat(64),
    })).toBe(false);
  });
});

function hashLike(value: string): string {
  return Buffer.from(value).toString("hex").padEnd(64, "0").slice(0, 64);
}

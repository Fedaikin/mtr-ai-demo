import { createEphemeralAttestationSigner } from "@/evals/fastgate/official/attestation";
import {
  createConnectorWitness,
  verifyConnectorHttpBindings,
  verifyConnectorWitnessEvent,
} from "@/evals/fastgate/official/connector-witness";
import type { TranscriptEntry } from "@/evals/fastgate/official/transcript";

describe("independent FastGate connector witness", () => {
  const proof = {
    proofId: "proof-stock-1",
    capability: "stock.read",
    connector: "SAP",
    operation: "getStock",
    subjectHash: "1".repeat(64),
    httpTemplateId: "FG-03:01",
    httpRequestHash: "2".repeat(64),
    normalizedArguments: { materialCode: "MAT-001" },
    argumentHash: "b26b34f2991df5b12156447d63f2b71eebbd2b2827b0da028aa1a084b071896f",
    sourceSnapshotId: "snapshot-a",
    sourceRowIds: ["row-a", "row-b"],
    sourceRowHashes: ["3".repeat(64), "4".repeat(64)],
    projectionHash: "0".repeat(64),
    resultHash: "5".repeat(64),
    resultStatus: "OK",
    snapshotIds: ["snapshot-a"],
  } as const;

  const argumentHash = "b26b34f2991df5b12156447d63f2b71eebbd2b2827b0da028aa1a084b071896f";

  it("signs only a source-backed event from a private proof index", () => {
    const signer = createEphemeralAttestationSigner({
      role: "CONNECTOR_WITNESS",
      runId: "run-witness",
      runNonce: "6".repeat(64),
      issuedAt: "2026-08-14T12:00:00.000Z",
    });
    const witness = createConnectorWitness({ signer, proofs: [proof] });
    const event = witness.observe({
      ordinal: 1,
      correlationId: "correlation-stock",
      proofId: proof.proofId,
      capability: proof.capability,
      connector: proof.connector,
      operation: proof.operation,
      subjectHash: proof.subjectHash,
      httpTemplateId: proof.httpTemplateId,
      httpRequestHash: proof.httpRequestHash,
      normalizedArguments: proof.normalizedArguments,
      argumentHash,
      sourceSnapshotId: proof.sourceSnapshotId,
      sourceRowIds: proof.sourceRowIds,
      sourceRowHashes: proof.sourceRowHashes,
      projectionHash: proof.projectionHash,
      resultHash: proof.resultHash,
      resultStatus: proof.resultStatus,
      snapshotIds: proof.snapshotIds,
      observedAt: "2026-08-14T12:00:01.000Z",
      monotonicOffsetMs: 1,
    });

    expect(verifyConnectorWitnessEvent(event, signer.certificate, { ...proof, argumentHash })).toBe(true);
    expect(JSON.stringify(event)).not.toContain("proof-stock-1\":{");
  });

  it("fails closed for unlisted proof, altered arguments, or altered result", () => {
    const signer = createEphemeralAttestationSigner({
      role: "CONNECTOR_WITNESS",
      runId: "run-witness",
      runNonce: "7".repeat(64),
      issuedAt: "2026-08-14T12:00:00.000Z",
    });
    const witness = createConnectorWitness({ signer, proofs: [proof] });
    const observed = { ...proof, argumentHash, ordinal: 1, correlationId: "c", observedAt: "2026-08-14T12:00:01.000Z", monotonicOffsetMs: 1 };
    expect(() => witness.observe({ ...observed, proofId: "unknown" })).toThrow("UNKNOWN_CONNECTOR_PROOF");
    expect(() => witness.observe({ ...observed, argumentHash: "9".repeat(64) })).toThrow("CONNECTOR_ARGUMENT_MISMATCH");
    expect(() => witness.observe({ ...observed, resultHash: "8".repeat(64) })).toThrow("CONNECTOR_RESULT_MISMATCH");
  });

  it("rejects a proof whose source-row commitment was not independently authorized", () => {
    const signer = createEphemeralAttestationSigner({
      role: "CONNECTOR_WITNESS",
      runId: "run-witness-live",
      runNonce: "8".repeat(64),
      issuedAt: "2026-08-14T12:00:00.000Z",
    });
    const witness = createConnectorWitness({ signer, proofs: [proof] });
    expect(() => witness.observe({
      ...proof,
      ordinal: 1,
      correlationId: "correlation-live-project-list",
      observedAt: "2026-08-14T12:00:01.000Z",
      monotonicOffsetMs: 1,
      sourceRowHashes: ["9".repeat(64)],
    })).toThrow("CONNECTOR_SOURCE_ROWS_MISMATCH");
  });

  it("binds every connector event to the signed HTTP template, request, and session subject", () => {
    const signer = createEphemeralAttestationSigner({
      role: "CONNECTOR_WITNESS",
      runId: "run-http-binding",
      runNonce: "a".repeat(64),
      issuedAt: "2026-08-14T12:00:00.000Z",
    });
    const event = createConnectorWitness({ signer, proofs: [proof] }).observe({
      ...proof,
      ordinal: 1,
      correlationId: "correlation-http-binding",
      observedAt: "2026-08-14T12:00:01.000Z",
      monotonicOffsetMs: 1,
    });
    const entry = {
      correlationId: "correlation-http-binding",
      subjectHash: proof.subjectHash,
      requestHash: proof.httpRequestHash,
      templateId: proof.httpTemplateId,
      isAgentMessage: true,
      retryOfOrdinal: null,
    } as TranscriptEntry;
    expect(verifyConnectorHttpBindings([event], [entry])).toBe(true);
    expect(verifyConnectorHttpBindings([event], [{ ...entry, requestHash: "9".repeat(64) }])).toBe(false);
    expect(verifyConnectorHttpBindings([event], [{ ...entry, templateId: "FG-03:02" }])).toBe(false);
    expect(verifyConnectorHttpBindings([event], [{ ...entry, subjectHash: "8".repeat(64) }])).toBe(false);
  });
});

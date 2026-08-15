import {
  canonicalJson,
  createEphemeralAttestationSigner,
  issueComponentCertificate,
  verifyAttestationEnvelope,
  verifyIssuedComponentCertificate,
} from "@/evals/fastgate/official/attestation";

describe("official FastGate attestation", () => {
  it("canonicalizes equivalent JSON and rejects unsupported values", () => {
    expect(canonicalJson({ b: 2, a: "е\u0308" })).toBe(canonicalJson({ a: "ё", b: 2 }));
    expect(() => canonicalJson({ value: Number.NaN })).toThrow("NON_CANONICAL_NUMBER");
    expect(() => canonicalJson({ value: undefined })).toThrow("UNSUPPORTED_CANONICAL_VALUE");
  });

  it("keeps private keys out of certificates, envelopes, and serialization", () => {
    const signer = createEphemeralAttestationSigner({
      role: "SUPERVISOR",
      runId: "run-official-1",
      runNonce: "a".repeat(64),
      issuedAt: "2026-08-14T12:00:00.000Z",
    });
    const envelope = signer.sign({ deploymentSha: "b".repeat(40), imageDigest: `sha256:${"c".repeat(64)}` });
    const serialized = JSON.stringify({ certificate: signer.certificate, envelope });

    expect(serialized).not.toMatch(/PRIVATE KEY|privateKey|seedPhrase/u);
    expect(verifyAttestationEnvelope(envelope, signer.certificate, {
      role: "SUPERVISOR",
      runId: "run-official-1",
      runNonce: "a".repeat(64),
    })).toBe(true);
  });

  it("rejects tampering, role substitution, and run replay", () => {
    const signer = createEphemeralAttestationSigner({
      role: "CONNECTOR_WITNESS",
      runId: "run-official-1",
      runNonce: "d".repeat(64),
      issuedAt: "2026-08-14T12:00:00.000Z",
    });
    const envelope = signer.sign({ rowHash: "e".repeat(64) });

    expect(verifyAttestationEnvelope({ ...envelope, payload: { rowHash: "f".repeat(64) } }, signer.certificate)).toBe(false);
    expect(verifyAttestationEnvelope(envelope, signer.certificate, { role: "HTTP_PROXY" })).toBe(false);
    expect(verifyAttestationEnvelope(envelope, signer.certificate, { runNonce: "0".repeat(64) })).toBe(false);
  });

  it("lets only the supervisor certify a component key for one image and nonce", () => {
    const root = createEphemeralAttestationSigner({
      role: "SUPERVISOR",
      runId: "run-chain",
      runNonce: "a".repeat(64),
      issuedAt: "2026-08-14T12:00:00.000Z",
    });
    const witness = createEphemeralAttestationSigner({
      role: "CONNECTOR_WITNESS",
      runId: "run-chain",
      runNonce: "a".repeat(64),
      issuedAt: "2026-08-14T12:00:01.000Z",
    });
    const issued = issueComponentCertificate(root, witness.certificate, `sha256:${"b".repeat(64)}`);
    expect(verifyIssuedComponentCertificate(issued, root.certificate, witness.certificate, {
      role: "CONNECTOR_WITNESS",
      imageDigest: `sha256:${"b".repeat(64)}`,
    })).toBe(true);
    expect(verifyIssuedComponentCertificate(issued, root.certificate, witness.certificate, {
      imageDigest: `sha256:${"c".repeat(64)}`,
    })).toBe(false);
    expect(() => issueComponentCertificate(witness, root.certificate, `sha256:${"b".repeat(64)}`))
      .toThrow("SUPERVISOR_SIGNER_REQUIRED");
  });
});

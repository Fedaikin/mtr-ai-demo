import { createHash, createPublicKey, verify as verifyBytes } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  verifyOfficialFastGateAggregate,
  type OfficialFastGateAggregate,
} from "@/evals/fastgate/official/verifier";
import { verifySignedTranscript, type SignedTranscript } from "@/evals/fastgate/official/transcript";
import {
  canonicalJson,
  verifyIssuedComponentCertificate,
  type AttestationCertificate,
  type AttestationEnvelope,
  type IssuedComponentCertificatePayload,
} from "@/evals/fastgate/official/attestation";
import {
  verifyConnectorHttpBindings,
  verifyConnectorWitnessEvent,
  type ConnectorProof,
  type ConnectorWitnessEvent,
} from "@/evals/fastgate/official/connector-witness";
import { verifyRunIdentity, type FastGateRunIdentity } from "@/evals/fastgate/supervisor";
import {
  verifyIndependentReviewWitnessEnvelope,
  type IndependentReviewWitnessEnvelope,
} from "@/evals/fastgate/official/reviewer-witness";

const artifactDir = resolve(requiredEnv("FASTGATE_ARTIFACT_DIR"));
const pinnedHostRootPath = resolve("infra/fastgate/trust/official-host-root.pem");
const reviewerWitnessScriptPath = resolve("scripts/fastgate-independent-review-witness.ts");
const aggregatePath = join(artifactDir, "aggregate.json");
if (!existsSync(aggregatePath)) {
  process.stderr.write("FASTGATE OFFLINE VERIFIER: AGGREGATE_NOT_FOUND\n");
  process.exitCode = 2;
} else {
  const aggregate = JSON.parse(readFileSync(aggregatePath, "utf8")) as OfficialFastGateAggregate;
  const aggregateVerification = verifyOfficialFastGateAggregate(aggregate);
  const packageErrors = verifyArtifactPackage(aggregate);
  const errors = [...aggregateVerification.errors, ...packageErrors];
  const verification = Object.freeze({
    ...aggregateVerification,
    valid: errors.length === 0,
    verdict: errors.length === 0 ? "PASS" as const : "FAIL" as const,
    errors: Object.freeze(errors),
  });
  writeFileSync(join(artifactDir, "verification.json"), `${JSON.stringify(verification, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
  if (!verification.valid) process.exitCode = 1;
}

function verifyArtifactPackage(aggregate: OfficialFastGateAggregate): string[] {
  const errors: string[] = [];
  const imageIsolationPath = join(artifactDir, "application-image-isolation-attestation.json");
  if (!existsSync(imageIsolationPath)) {
    errors.push("APPLICATION_IMAGE_ISOLATION_ATTESTATION_MISSING");
  } else {
    const isolation = readJson<Record<string, unknown>>(imageIsolationPath);
    if (isolation.schemaVersion !== "mtr-fastgate-application-image-isolation-v1"
      || isolation.verified !== true || isolation.applicationProcessUid !== 1000
      || isolation.evaluatorReadableByApplication !== false
      || isolation.manifestReadableByApplication !== false
      || isolation.scoringReadableByApplication !== false
      || isolation.controlWrapperReadableByApplication !== false
      || isolation.imageDigest !== aggregate.runs[0]?.applicationImageDigest) {
      errors.push("APPLICATION_IMAGE_ISOLATION_ATTESTATION_INVALID");
    }
  }
  for (const file of aggregate.artifactFiles) {
    const path = join(artifactDir, file.path);
    if (!existsSync(path)) {
      errors.push(`ARTIFACT_MISSING:${file.path}`);
      continue;
    }
    const bytes = readFileSync(path);
    if (statSync(path).size !== file.bytes) errors.push(`ARTIFACT_SIZE_MISMATCH:${file.path}`);
    if (sha256(bytes) !== file.sha256) errors.push(`ARTIFACT_HASH_MISMATCH:${file.path}`);
  }

  aggregate.runs.forEach((run, index) => {
    const prefix = `run-${index + 1}`;
    const finalEvidencePath = join(artifactDir, prefix, "run-evidence.json");
    const required = [
      "run-evidence.partial.json", "run-evidence.json", "security-gate.json", "load-gate.json",
      "raw-proxy/http-transcript.final.json", "raw-witness/connector-transcript.final.json",
      "raw-proxy/http-proxy-certificate.json", "raw-witness/connector-witness-certificate.json",
      "raw-witness/supervisor-certificate.json", "raw-witness/issued-connector-witness-certificate.json",
      "runtime-container-attestation.json", "host-attestation.json",
      "run-identity.json",
      "post-run-target-state.json",
      "counterfactual-commitment.json", "evaluator/result.json", "evaluator/report.md",
    ];
    for (const file of required) if (!existsSync(join(artifactDir, prefix, file))) errors.push(`REQUIRED_RUN_ARTIFACT_MISSING:${prefix}/${file}`);
    if (!existsSync(finalEvidencePath)) return;
    const persisted = readJson<Record<string, unknown>>(finalEvidencePath);
    if (JSON.stringify(persisted) !== JSON.stringify(run)) errors.push(`RUN_EVIDENCE_AGGREGATE_MISMATCH:${run.runId}`);
    try {
      const targetState = readJson<Record<string, unknown>>(join(artifactDir, prefix, "post-run-target-state.json"));
      const mutation = targetState.databaseMutationAttestation as Record<string, unknown> | undefined;
      if (targetState.schemaVersion !== "mtr-fastgate-post-run-state-verification-v2"
        || targetState.verified !== true
        || targetState.baselineTargetStateChecksum !== targetState.expectedTargetStateChecksum
        || targetState.expectedTargetStateChecksum !== targetState.observedTargetStateChecksum
        || targetState.expectedDataChecksum !== targetState.observedDataChecksum
        || !mutation || mutation.valid !== true
        || !Array.isArray(mutation.unexpectedChangedTables) || mutation.unexpectedChangedTables.length !== 0
        || !Array.isArray(mutation.nonAppendOnlyTables) || mutation.nonAppendOnlyTables.length !== 0
        || !Array.isArray(mutation.errors) || mutation.errors.length !== 0
        || mutation.actionDelta !== 1) {
        errors.push(`POST_RUN_TARGET_STATE_INVALID:${run.runId}`);
      }
      const http = readJson<SignedTranscript>(join(artifactDir, prefix, "raw-proxy", "http-transcript.final.json"));
      const httpCertificate = readJson<AttestationCertificate>(join(artifactDir, prefix, "raw-proxy", "http-proxy-certificate.json"));
      const httpResult = verifySignedTranscript(http, httpCertificate, {
        expectedRunId: run.runId,
        transcriptKind: "HTTP",
        expectedAgentMessages: 23,
      });
      if (!httpResult.valid) errors.push(`HTTP_TRANSCRIPT_CRYPTOGRAPHIC_FAILURE:${run.runId}:${httpResult.errors.join("|")}`);
      const connector = readJson<{
        runId: string;
        runNonce: string;
        certificate: AttestationCertificate;
        supervisorCertificate: AttestationCertificate;
        issuedCertificate: AttestationEnvelope<IssuedComponentCertificatePayload>;
        events: ConnectorWitnessEvent[];
      }>(
        join(artifactDir, prefix, "raw-witness", "connector-transcript.final.json"),
      );
      const runIdentity = readJson<FastGateRunIdentity>(join(artifactDir, prefix, "run-identity.json"));
      const chainValid = verifyIssuedComponentCertificate(
        connector.issuedCertificate,
        connector.supervisorCertificate,
        connector.certificate,
        { role: "CONNECTOR_WITNESS", imageDigest: run.witnessImageDigest },
      );
      const runIdentityValid = verifyRunIdentity(runIdentity)
        && runIdentity.runId === run.runId
        && runIdentity.deploymentSha === run.deploymentSha
        && runIdentity.attestationRootKeyId === connector.supervisorCertificate.keyId
        && runIdentity.attestationRootPublicKeyPem === connector.supervisorCertificate.publicKeyPem;
      let previousEventSha256 = "0".repeat(64);
      const connectorInvalid = connector.events.some((event, eventIndex) => {
        const payload = event.payload;
        const proof: ConnectorProof = {
          proofId: payload.proofId,
          capability: payload.capability,
          connector: payload.connector,
          operation: payload.operation,
          subjectHash: payload.subjectHash,
          httpTemplateId: payload.httpTemplateId,
          httpRequestHash: payload.httpRequestHash,
          normalizedArguments: payload.normalizedArguments,
          argumentHash: payload.argumentHash,
          sourceSnapshotId: payload.sourceSnapshotId,
          sourceRowIds: payload.sourceRowIds,
          sourceRowHashes: payload.sourceRowHashes,
          projectionHash: payload.projectionHash,
          resultHash: payload.resultHash,
          resultStatus: payload.resultStatus,
          snapshotIds: payload.snapshotIds,
        };
        const valid = payload.ordinal === eventIndex + 1 && payload.previousEventSha256 === previousEventSha256
          && verifyConnectorWitnessEvent(event, connector.certificate, proof);
        previousEventSha256 = payload.eventSha256;
        return !valid;
      });
      if (!chainValid || !runIdentityValid || connector.runId !== run.runId || connector.certificate.runId !== run.runId
        || connector.events.length === 0 || connectorInvalid
        || !verifyConnectorHttpBindings(connector.events, http.entries)) {
        errors.push(`CONNECTOR_TRANSCRIPT_CRYPTOGRAPHIC_FAILURE:${run.runId}`);
      }
      verifyHostRunAttestation(prefix, run, errors);
    } catch {
      errors.push(`TRANSCRIPT_VERIFICATION_EXCEPTION:${run.runId}`);
    }
  });

  const reviewPath = join(artifactDir, "independent-review.json");
  const reviewRawPath = join(artifactDir, "independent-review-raw.json");
  const reviewInputPath = join(artifactDir, "independent-review-input.json");
  const reviewTranscriptPath = join(artifactDir, "independent-review-codex.jsonl");
  const reviewWitnessPath = join(artifactDir, "independent-review-witness.json");
  const reviewAttestationPath = join(artifactDir, "independent-review-host-attestation.json");
  const preReviewCommitmentPath = join(artifactDir, "pre-review-artifact-commitment.json");
  if (![reviewPath, reviewRawPath, reviewInputPath, reviewTranscriptPath, reviewWitnessPath, reviewAttestationPath, preReviewCommitmentPath].every(existsSync)) {
    errors.push("INDEPENDENT_REVIEW_ARTIFACT_MISSING");
  } else {
    try {
      const review = readJson<Record<string, unknown>>(reviewPath);
      const reviewInput = readJson<Record<string, unknown>>(reviewInputPath);
      const reviewWitness = readJson<IndependentReviewWitnessEnvelope>(reviewWitnessPath);
      const preReview = readJson<{ schemaVersion?: string; files?: Array<{ path: string; bytes: number; sha256: string }>; commitmentSha256?: string }>(preReviewCommitmentPath);
      const attestation = readJson<{ schemaVersion?: string; payload?: Record<string, unknown>; signatureBase64?: string }>(reviewAttestationPath);
      const build = readJson<{ baseSha?: string; finalSha?: string; sourceTreeSha256?: string; imageDigests?: Record<string, string> }>(
        join(artifactDir, "build-attestation.json"),
      );
      const root = readJson<{ schemaVersion?: string; keyId?: string; publicKeyPem?: string }>(join(artifactDir, "host-root-certificate.json"));
      const pinnedPublicKeyPem = readFileSync(pinnedHostRootPath, "utf8");
      const pinnedRootDer = createPublicKey(pinnedPublicKeyPem).export({ format: "der", type: "spki" });
      const rootMatchesPinned = typeof root.publicKeyPem === "string"
        && Buffer.from(createPublicKey(root.publicKeyPem).export({ format: "der", type: "spki" })).equals(Buffer.from(pinnedRootDer))
        && root.keyId === sha256(pinnedRootDer);
      const inputCommitmentSha256 = sha256(Buffer.from(canonicalJson(reviewInput)));
      const preReviewFiles = preReview.files ?? [];
      const preReviewFilesValid = preReview.schemaVersion === "fastgate-pre-review-artifact-commitment-v1"
        && preReviewFiles.length > 0
        && preReviewFiles.every((file) => isSafeArtifactFile(file)
          && existsSync(join(artifactDir, file.path))
          && statSync(join(artifactDir, file.path)).size === file.bytes
          && fileSha(join(artifactDir, file.path)) === file.sha256);
      const runArtifactCommitmentSha256 = sha256(Buffer.from(canonicalJson(preReviewFiles)));
      const imageDigests = reviewInput.imageDigests && typeof reviewInput.imageDigests === "object"
        ? reviewInput.imageDigests as Record<string, string> : {};
      const imageDigestsSha256 = sha256(Buffer.from(canonicalJson(imageDigests)));
      const firstRun = aggregate.runs[0];
      const expectedImages = firstRun ? {
        application: firstRun.applicationImageDigest,
        witness: firstRun.witnessImageDigest,
        proxy: firstRun.proxyImageDigest,
        supervisor: firstRun.supervisorImageDigest,
        verifier: firstRun.verifierImageDigest,
      } : {};
      const reviewerWitnessScriptSha256 = fileSha(reviewerWitnessScriptPath);
      const reviewerTranscriptSha256 = sha256(readFileSync(reviewTranscriptPath));
      const reviewOutputSha256 = sha256(readFileSync(reviewRawPath));
      const reviewerWitnessValid = verifyIndependentReviewWitnessEnvelope(reviewWitness, {
        finalSha: String(review.finalSha ?? ""),
        sourceTreeSha256: String(review.sourceTreeSha256 ?? ""),
        witnessScriptSha256: reviewerWitnessScriptSha256,
        inputCommitmentSha256,
        stdoutSha256: reviewerTranscriptSha256,
        outputSha256: reviewOutputSha256,
      });
      const reviewValid = review.schemaVersion === "fastgate-independent-review-v1"
        && review.baseSha === reviewInput.baseSha && review.baseSha === build.baseSha
        && review.finalSha === firstRun?.deploymentSha && review.finalSha === reviewInput.finalSha && review.finalSha === build.finalSha
        && review.sourceTreeSha256 === firstRun?.sourceTreeSha256
        && review.sourceTreeSha256 === reviewInput.sourceTreeSha256 && review.sourceTreeSha256 === build.sourceTreeSha256
        && canonicalJson(imageDigests) === canonicalJson(expectedImages)
        && canonicalJson(imageDigests) === canonicalJson(build.imageDigests ?? {})
        && review.imageDigestsSha256 === imageDigestsSha256
        && preReviewFilesValid && preReview.commitmentSha256 === runArtifactCommitmentSha256
        && review.runArtifactCommitmentSha256 === runArtifactCommitmentSha256
        && reviewInput.runArtifactCommitmentSha256 === runArtifactCommitmentSha256
        && review.inputCommitmentSha256 === inputCommitmentSha256
        && review.inputCommitmentSha256 === aggregate.independentReview.inputCommitmentSha256
        && review.outputSha256 === reviewOutputSha256
        && review.outputSha256 === aggregate.independentReview.artifactSha256
        && review.reviewerNonceSha256 === reviewInput.reviewerNonceSha256
        && review.reviewerSessionIdHash === reviewWitness.payload.reviewerSessionIdHash
        && review.reviewerWitnessKeyId === reviewWitness.certificate.keyId
        && review.reviewerWitnessScriptSha256 === reviewerWitnessScriptSha256
        && review.reviewerTranscriptSha256 === reviewerTranscriptSha256
        && review.reviewerExecutableSha256 === reviewWitness.payload.codexExecutableSha256
        && reviewerWitnessValid
        && review.readOnlyAttested === true && review.exitStatus === 0 && review.verdict === "PASS"
        && Number((review.findings as Record<string, unknown> | undefined)?.P0 ?? 1) === 0
        && Number((review.findings as Record<string, unknown> | undefined)?.P1 ?? 1) === 0
        && Number((review.findings as Record<string, unknown> | undefined)?.P2 ?? 1) === 0;
      if (!reviewValid) errors.push("INDEPENDENT_REVIEW_ARTIFACT_INVALID");
      if (review.inputCommitmentSha256 !== inputCommitmentSha256) {
        errors.push("INDEPENDENT_REVIEW_INPUT_COMMITMENT_INVALID");
      }
      const payload = attestation.payload ?? {};
      const payloadValid = attestation.schemaVersion === "mtr-fastgate-host-independent-review-attestation-envelope-v1"
        && payload.schemaVersion === "mtr-fastgate-host-independent-review-attestation-v1"
        && payload.rootKeyId === root.keyId
        && payload.baseSha === review.baseSha && payload.finalSha === review.finalSha
        && payload.sourceTreeSha256 === review.sourceTreeSha256
        && payload.imageDigestsSha256 === review.imageDigestsSha256
        && payload.runArtifactCommitmentSha256 === review.runArtifactCommitmentSha256
        && payload.inputCommitmentSha256 === review.inputCommitmentSha256
        && payload.outputSha256 === review.outputSha256
        && payload.reviewerWitnessEnvelopeSha256 === fileSha(reviewWitnessPath)
        && payload.reviewRecordSha256 === sha256(Buffer.from(canonicalJson(review)))
        && typeof attestation.signatureBase64 === "string"
        && verifyBytes(null, Buffer.from(canonicalJson(payload)), pinnedPublicKeyPem, Buffer.from(attestation.signatureBase64, "base64"));
      if (!rootMatchesPinned || !payloadValid) errors.push("INDEPENDENT_REVIEW_HOST_ATTESTATION_INVALID");
    } catch {
      errors.push("INDEPENDENT_REVIEW_VERIFICATION_EXCEPTION");
    }
  }
  return errors;
}

function verifyHostRunAttestation(prefix: string, run: OfficialFastGateAggregate["runs"][number], errors: string[]): void {
  const root = readJson<{ schemaVersion: string; keyId: string; publicKeyPem: string }>(join(artifactDir, "host-root-certificate.json"));
  const pinnedPublicKeyPem = readFileSync(pinnedHostRootPath, "utf8");
  const envelope = readJson<{
    schemaVersion: string;
    payload: {
      schemaVersion: string;
      runId: string;
      deploymentSha: string;
      sourceTreeSha256: string;
      rootKeyId: string;
      imageDigests: Record<string, string>;
      runtimeContainerAttestationSha256: string;
      runIdentitySha256: string;
      httpProxyCertificateSha256: string;
      httpTranscriptSha256: string;
      connectorWitnessCertificateSha256: string;
      supervisorCertificateSha256: string;
      issuedConnectorWitnessCertificateSha256: string;
      connectorTranscriptSha256: string;
      postRunTargetStateSha256: string;
    };
    signatureBase64: string;
  }>(join(artifactDir, prefix, "host-attestation.json"));
  const runtime = readJson<{ verified?: boolean; observed?: Record<string, string> }>(join(artifactDir, prefix, "runtime-container-attestation.json"));
  const expectedImages = {
    application: run.applicationImageDigest,
    witness: run.witnessImageDigest,
    proxy: run.proxyImageDigest,
    supervisor: run.supervisorImageDigest,
    verifier: run.verifierImageDigest,
  };
  const payload = envelope.payload;
  const rootDer = createPublicKey(root.publicKeyPem).export({ format: "der", type: "spki" });
  const pinnedRootDer = createPublicKey(pinnedPublicKeyPem).export({ format: "der", type: "spki" });
  const valid = root.schemaVersion === "mtr-fastgate-host-root-v1"
    && Buffer.from(rootDer).equals(Buffer.from(pinnedRootDer))
    && root.keyId === sha256(pinnedRootDer);
  const hashesMatch = payload.runtimeContainerAttestationSha256 === fileSha(join(artifactDir, prefix, "runtime-container-attestation.json"))
    && payload.runIdentitySha256 === fileSha(join(artifactDir, prefix, "run-identity.json"))
    && payload.httpProxyCertificateSha256 === fileSha(join(artifactDir, prefix, "raw-proxy", "http-proxy-certificate.json"))
    && payload.httpTranscriptSha256 === fileSha(join(artifactDir, prefix, "raw-proxy", "http-transcript.final.json"))
    && payload.connectorWitnessCertificateSha256 === fileSha(join(artifactDir, prefix, "raw-witness", "connector-witness-certificate.json"))
    && payload.supervisorCertificateSha256 === fileSha(join(artifactDir, prefix, "raw-witness", "supervisor-certificate.json"))
    && payload.issuedConnectorWitnessCertificateSha256 === fileSha(join(artifactDir, prefix, "raw-witness", "issued-connector-witness-certificate.json"))
    && payload.connectorTranscriptSha256 === fileSha(join(artifactDir, prefix, "raw-witness", "connector-transcript.final.json"));
  const targetStateHashMatches = payload.postRunTargetStateSha256 === fileSha(join(artifactDir, prefix, "post-run-target-state.json"));
  const signatureValid = verifyBytes(null, Buffer.from(canonicalJson(payload)), pinnedPublicKeyPem, Buffer.from(envelope.signatureBase64, "base64"));
  const imagesMatch = canonicalJson(payload.imageDigests) === canonicalJson(expectedImages)
    && runtime.verified === true
    && runtime.observed?.application === run.applicationImageDigest
    && runtime.observed?.["connector-witness"] === run.witnessImageDigest
    && runtime.observed?.["http-proxy"] === run.proxyImageDigest
    && runtime.observed?.supervisor === run.supervisorImageDigest;
  if (!valid || envelope.schemaVersion !== "mtr-fastgate-host-run-attestation-envelope-v1"
    || payload.schemaVersion !== "mtr-fastgate-host-run-attestation-v1" || payload.runId !== run.runId
    || payload.deploymentSha !== run.deploymentSha || payload.sourceTreeSha256 !== run.sourceTreeSha256
    || payload.rootKeyId !== root.keyId || !hashesMatch || !targetStateHashMatches || !signatureValid || !imagesMatch) {
    errors.push(`HOST_RUNTIME_ATTESTATION_INVALID:${run.runId}`);
  }
}

function readJson<T>(path: string): T { return JSON.parse(readFileSync(path, "utf8")) as T; }
function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function fileSha(path: string): string { return sha256(readFileSync(path)); }

function isSafeArtifactFile(file: Readonly<{ path: string; bytes: number; sha256: string }>): boolean {
  return Boolean(file.path) && !file.path.startsWith("/") && !file.path.split("/").includes("..") && !file.path.includes("\\")
    && Number.isInteger(file.bytes) && file.bytes >= 0 && /^[a-f0-9]{64}$/u.test(file.sha256);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

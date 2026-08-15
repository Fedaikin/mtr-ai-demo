import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";

import { canonicalJson } from "@/evals/fastgate/official/attestation";

export interface IndependentReviewFindings {
  readonly P0: number;
  readonly P1: number;
  readonly P2: number;
  readonly P3: number;
}

export interface IndependentReviewOutput {
  readonly findings: IndependentReviewFindings;
  readonly verdict: "PASS" | "FAIL";
  readonly summary: string;
}

export interface IndependentReviewWitnessCertificate {
  readonly schemaVersion: "mtr-fastgate-independent-review-witness-certificate-v1";
  readonly finalSha: string;
  readonly sourceTreeSha256: string;
  readonly witnessScriptSha256: string;
  readonly issuedAt: string;
  readonly keyId: string;
  readonly publicKeyPem: string;
}

export interface IndependentReviewWitnessPayload {
  readonly schemaVersion: "mtr-fastgate-independent-review-witness-payload-v1";
  readonly inputCommitmentSha256: string;
  readonly codexExecutableSha256: string;
  readonly codexVersion: string;
  readonly commandArgvSha256: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly exitStatus: number;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly reviewerSessionIdHash: string;
  readonly outputSha256: string;
  readonly findings: IndependentReviewFindings;
  readonly verdict: "PASS" | "FAIL";
}

export interface IndependentReviewWitnessEnvelope {
  readonly schemaVersion: "mtr-fastgate-independent-review-witness-envelope-v1";
  readonly certificate: IndependentReviewWitnessCertificate;
  readonly payloadSha256: string;
  readonly payload: IndependentReviewWitnessPayload;
  readonly signatureBase64: string;
}

export function createIndependentReviewWitnessSigner(input: Readonly<{
  finalSha: string;
  sourceTreeSha256: string;
  witnessScriptSha256: string;
  issuedAt: string;
}>): Readonly<{
  certificate: IndependentReviewWitnessCertificate;
  sign(payload: Omit<IndependentReviewWitnessPayload, "schemaVersion">): IndependentReviewWitnessEnvelope;
}> {
  assertHash(input.finalSha, 40, "INVALID_REVIEW_FINAL_SHA");
  assertHash(input.sourceTreeSha256, 64, "INVALID_REVIEW_SOURCE_SHA");
  assertHash(input.witnessScriptSha256, 64, "INVALID_REVIEW_WITNESS_SCRIPT_SHA");
  if (!Number.isFinite(Date.parse(input.issuedAt))) throw new Error("INVALID_REVIEW_WITNESS_TIME");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const keyId = sha256(publicKey.export({ format: "der", type: "spki" }));
  const certificate: IndependentReviewWitnessCertificate = Object.freeze({
    schemaVersion: "mtr-fastgate-independent-review-witness-certificate-v1",
    ...input,
    keyId,
    publicKeyPem,
  });
  return Object.freeze({
    certificate,
    sign(payloadInput): IndependentReviewWitnessEnvelope {
      const payload: IndependentReviewWitnessPayload = Object.freeze({
        schemaVersion: "mtr-fastgate-independent-review-witness-payload-v1",
        ...payloadInput,
      });
      const payloadSha256 = sha256(canonicalJson(payload));
      const unsigned = Object.freeze({
        schemaVersion: "mtr-fastgate-independent-review-witness-envelope-v1" as const,
        certificate,
        payloadSha256,
      });
      return Object.freeze({
        ...unsigned,
        payload,
        signatureBase64: signBytes(null, Buffer.from(canonicalJson(unsigned)), privateKey).toString("base64"),
      });
    },
  });
}

export function verifyIndependentReviewWitnessEnvelope(
  envelope: IndependentReviewWitnessEnvelope,
  expected: Readonly<{
    finalSha: string;
    sourceTreeSha256: string;
    witnessScriptSha256: string;
    inputCommitmentSha256: string;
    stdoutSha256: string;
    outputSha256: string;
  }>,
): boolean {
  try {
    const certificate = envelope.certificate;
    const payload = envelope.payload;
    const publicKeyDer = Buffer.from(createPublicKey(certificate.publicKeyPem).export({ format: "der", type: "spki" }));
    if (envelope.schemaVersion !== "mtr-fastgate-independent-review-witness-envelope-v1"
      || certificate.schemaVersion !== "mtr-fastgate-independent-review-witness-certificate-v1"
      || payload.schemaVersion !== "mtr-fastgate-independent-review-witness-payload-v1"
      || certificate.finalSha !== expected.finalSha
      || certificate.sourceTreeSha256 !== expected.sourceTreeSha256
      || certificate.witnessScriptSha256 !== expected.witnessScriptSha256
      || certificate.keyId !== sha256(publicKeyDer)
      || payload.inputCommitmentSha256 !== expected.inputCommitmentSha256
      || payload.stdoutSha256 !== expected.stdoutSha256
      || payload.outputSha256 !== expected.outputSha256
      || envelope.payloadSha256 !== sha256(canonicalJson(payload))) return false;
    const unsigned = {
      schemaVersion: envelope.schemaVersion,
      certificate,
      payloadSha256: envelope.payloadSha256,
    };
    return verifyBytes(
      null,
      Buffer.from(canonicalJson(unsigned)),
      certificate.publicKeyPem,
      Buffer.from(envelope.signatureBase64, "base64"),
    );
  } catch {
    return false;
  }
}

export function parseCodexReviewJsonl(jsonl: string): Readonly<{
  threadId: string;
  outputText: string;
  output: IndependentReviewOutput;
}> {
  let threadId: string | null = null;
  let outputText: string | null = null;
  for (const line of jsonl.split(/\r?\n/u).filter(Boolean)) {
    const event = JSON.parse(line) as Record<string, unknown>;
    if (event.type === "thread.started" && typeof event.thread_id === "string") threadId = event.thread_id;
    if (event.type === "item.completed") {
      const item = isRecord(event.item) ? event.item : {};
      if (item.type === "agent_message" && typeof item.text === "string") outputText = item.text;
    }
  }
  if (!threadId) throw new Error("INDEPENDENT_REVIEW_THREAD_ID_MISSING");
  if (!outputText) throw new Error("INDEPENDENT_REVIEW_OUTPUT_MISSING");
  const output = parseReviewOutput(JSON.parse(outputText));
  return Object.freeze({ threadId, outputText, output });
}

function parseReviewOutput(value: unknown): IndependentReviewOutput {
  if (!isRecord(value) || !isRecord(value.findings)
    || (value.verdict !== "PASS" && value.verdict !== "FAIL") || typeof value.summary !== "string") {
    throw new Error("INDEPENDENT_REVIEW_OUTPUT_INVALID");
  }
  const findings = value.findings;
  for (const key of ["P0", "P1", "P2", "P3"] as const) {
    if (!Number.isInteger(findings[key]) || Number(findings[key]) < 0) throw new Error("INDEPENDENT_REVIEW_FINDINGS_INVALID");
  }
  return Object.freeze({
    findings: Object.freeze({
      P0: Number(findings.P0), P1: Number(findings.P1), P2: Number(findings.P2), P3: Number(findings.P3),
    }),
    verdict: value.verdict,
    summary: value.summary,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertHash(value: string, length: number, error: string): void {
  if (!new RegExp(`^[a-f0-9]{${length}}$`, "u").test(value)) throw new Error(error);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

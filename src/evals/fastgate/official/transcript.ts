import {
  canonicalJson,
  sha256Hex,
  verifyAttestationEnvelope,
  type AttestationCertificate,
  type AttestationEnvelope,
  type EphemeralAttestationSigner,
} from "@/evals/fastgate/official/attestation";

export type TranscriptKind = "HTTP" | "CONNECTOR";

export interface TranscriptObservation {
  readonly ordinal: number;
  readonly startedOffsetMs: number;
  readonly finishedOffsetMs: number;
  readonly method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
  readonly normalizedRoute: string;
  readonly correlationId: string;
  readonly subjectHash: string | null;
  readonly permissionSetHash: string | null;
  readonly threadIdHash: string | null;
  readonly messageIdHash: string | null;
  readonly requestHash: string;
  readonly responseHash: string;
  readonly status: number;
  readonly templateId: string | null;
  readonly isAgentMessage: boolean;
  readonly retryOfOrdinal: number | null;
}

export interface TranscriptEntry extends TranscriptObservation {
  readonly previousEntryHash: string;
  readonly entryHash: string;
}

interface TranscriptCommitment {
  readonly transcriptKind: TranscriptKind;
  readonly entryCount: number;
  readonly finalEntryHash: string;
  readonly entriesSha256: string;
}

export interface SignedTranscript {
  readonly schemaVersion: "mtr-fastgate-signed-transcript-v1";
  readonly transcriptKind: TranscriptKind;
  readonly runId: string;
  readonly runNonce: string;
  readonly entries: readonly TranscriptEntry[];
  readonly commitment: AttestationEnvelope<TranscriptCommitment>;
}

export function createSignedTranscriptRecorder(input: Readonly<{
  signer: EphemeralAttestationSigner;
  transcriptKind: TranscriptKind;
}>): Readonly<{
  append(observation: TranscriptObservation): void;
  close(): SignedTranscript;
}> {
  const entries: TranscriptEntry[] = [];
  let closed = false;

  return Object.freeze({
    append(observation: TranscriptObservation): void {
      if (closed) throw new Error("TRANSCRIPT_ALREADY_CLOSED");
      if (observation.ordinal !== entries.length + 1) throw new Error("INVALID_TRANSCRIPT_ORDINAL");
      validateObservation(observation);
      const previousEntryHash = entries.at(-1)?.entryHash ?? "0".repeat(64);
      const entryHash = sha256Hex(canonicalJson({ ...observation, previousEntryHash }));
      entries.push(Object.freeze({ ...observation, previousEntryHash, entryHash }));
    },
    close(): SignedTranscript {
      if (closed) throw new Error("TRANSCRIPT_ALREADY_CLOSED");
      closed = true;
      const immutableEntries = Object.freeze([...entries]);
      const commitmentPayload: TranscriptCommitment = Object.freeze({
        transcriptKind: input.transcriptKind,
        entryCount: immutableEntries.length,
        finalEntryHash: immutableEntries.at(-1)?.entryHash ?? "0".repeat(64),
        entriesSha256: sha256Hex(canonicalJson(immutableEntries)),
      });
      return Object.freeze({
        schemaVersion: "mtr-fastgate-signed-transcript-v1",
        transcriptKind: input.transcriptKind,
        runId: input.signer.certificate.runId,
        runNonce: input.signer.certificate.runNonce,
        entries: immutableEntries,
        commitment: input.signer.sign(commitmentPayload),
      });
    },
  });
}

export function verifySignedTranscript(
  transcript: SignedTranscript,
  certificate: AttestationCertificate,
  expected: Readonly<{
    expectedEntries?: number;
    expectedRunId?: string;
    expectedRunNonce?: string;
    transcriptKind?: TranscriptKind;
    expectedAgentMessages?: number;
    expectedTemplateIds?: readonly string[];
  }> = {},
): Readonly<{ valid: boolean; errors: readonly string[] }> {
  const errors: string[] = [];
  if (transcript.schemaVersion !== "mtr-fastgate-signed-transcript-v1") errors.push("INVALID_TRANSCRIPT_SCHEMA");
  if (expected.expectedEntries !== undefined && transcript.entries.length !== expected.expectedEntries) errors.push("ENTRY_COUNT_MISMATCH");
  if (expected.expectedRunId !== undefined && transcript.runId !== expected.expectedRunId) errors.push("RUN_ID_MISMATCH");
  if (expected.expectedRunNonce !== undefined && transcript.runNonce !== expected.expectedRunNonce) errors.push("RUN_NONCE_MISMATCH");
  if (expected.transcriptKind !== undefined && transcript.transcriptKind !== expected.transcriptKind) errors.push("TRANSCRIPT_KIND_MISMATCH");
  const messages = transcript.entries.filter((entry) => entry.isAgentMessage && entry.retryOfOrdinal === null);
  if (expected.expectedAgentMessages !== undefined && messages.length !== expected.expectedAgentMessages) errors.push("AGENT_MESSAGE_COUNT_MISMATCH");
  if (expected.expectedTemplateIds !== undefined) {
    const actual = messages.map((entry) => entry.templateId);
    if (canonicalJson(actual) !== canonicalJson(expected.expectedTemplateIds)) errors.push("SCHEDULE_TEMPLATE_MISMATCH");
  }
  if (transcript.runId !== certificate.runId || transcript.runNonce !== certificate.runNonce) errors.push("CERTIFICATE_SCOPE_MISMATCH");

  let previousEntryHash = "0".repeat(64);
  transcript.entries.forEach((entry, index) => {
    if (entry.ordinal !== index + 1) errors.push(`INVALID_ORDINAL:${index + 1}`);
    if (entry.previousEntryHash !== previousEntryHash) errors.push(`BROKEN_HASH_CHAIN:${index + 1}`);
    const calculated = sha256Hex(canonicalJson({
      ordinal: entry.ordinal,
      startedOffsetMs: entry.startedOffsetMs,
      finishedOffsetMs: entry.finishedOffsetMs,
      method: entry.method,
      normalizedRoute: entry.normalizedRoute,
      correlationId: entry.correlationId,
      subjectHash: entry.subjectHash,
      permissionSetHash: entry.permissionSetHash,
      threadIdHash: entry.threadIdHash,
      messageIdHash: entry.messageIdHash,
      requestHash: entry.requestHash,
      responseHash: entry.responseHash,
      status: entry.status,
      templateId: entry.templateId,
      isAgentMessage: entry.isAgentMessage,
      retryOfOrdinal: entry.retryOfOrdinal,
      previousEntryHash: entry.previousEntryHash,
    }));
    if (calculated !== entry.entryHash) errors.push(`ENTRY_HASH_MISMATCH:${index + 1}`);
    previousEntryHash = entry.entryHash;
  });

  const payload = transcript.commitment.payload;
  if (payload.transcriptKind !== transcript.transcriptKind) errors.push("COMMITMENT_KIND_MISMATCH");
  if (payload.entryCount !== transcript.entries.length) errors.push("COMMITMENT_COUNT_MISMATCH");
  if (payload.finalEntryHash !== previousEntryHash) errors.push("COMMITMENT_FINAL_HASH_MISMATCH");
  if (payload.entriesSha256 !== sha256Hex(canonicalJson(transcript.entries))) errors.push("COMMITMENT_ENTRIES_HASH_MISMATCH");
  if (!verifyAttestationEnvelope(transcript.commitment, certificate)) errors.push("INVALID_TRANSCRIPT_SIGNATURE");
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

function validateObservation(observation: TranscriptObservation): void {
  if (!Number.isInteger(observation.ordinal) || observation.ordinal <= 0) throw new Error("INVALID_TRANSCRIPT_ORDINAL");
  if (!observation.correlationId.trim()) throw new Error("INVALID_CORRELATION_ID");
  if (!Number.isFinite(observation.startedOffsetMs) || observation.startedOffsetMs < 0) throw new Error("INVALID_START_OFFSET");
  if (!Number.isFinite(observation.finishedOffsetMs) || observation.finishedOffsetMs < observation.startedOffsetMs) throw new Error("INVALID_FINISH_OFFSET");
  if (!observation.normalizedRoute.startsWith("/")) throw new Error("INVALID_NORMALIZED_ROUTE");
  for (const hash of [observation.subjectHash, observation.permissionSetHash, observation.threadIdHash, observation.messageIdHash]) {
    if (hash !== null && !/^[a-f0-9]{64}$/u.test(hash)) throw new Error("INVALID_IDENTITY_HASH");
  }
  if (!/^[a-f0-9]{64}$/u.test(observation.requestHash)) throw new Error("INVALID_REQUEST_HASH");
  if (!/^[a-f0-9]{64}$/u.test(observation.responseHash)) throw new Error("INVALID_RESPONSE_HASH");
  if (!Number.isInteger(observation.status) || observation.status < 100 || observation.status > 599) throw new Error("INVALID_STATUS");
  if (observation.isAgentMessage && !observation.templateId) throw new Error("MESSAGE_TEMPLATE_REQUIRED");
  if (observation.retryOfOrdinal !== null && (!Number.isInteger(observation.retryOfOrdinal) || observation.retryOfOrdinal <= 0 || observation.retryOfOrdinal >= observation.ordinal)) {
    throw new Error("INVALID_RETRY_ORDINAL");
  }
}

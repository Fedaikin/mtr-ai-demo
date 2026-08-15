import {
  canonicalJson,
  sha256Hex,
  verifyAttestationEnvelope,
  type AttestationCertificate,
  type AttestationEnvelope,
  type EphemeralAttestationSigner,
} from "@/evals/fastgate/official/attestation";
import type { TranscriptEntry } from "@/evals/fastgate/official/transcript";

export interface ConnectorProof {
  readonly proofId: string;
  readonly capability: string;
  readonly connector: "APPIUS" | "SAP" | "PROCESS" | "NORMATIVE" | "CATALOG";
  readonly operation: string;
  readonly subjectHash: string;
  readonly httpTemplateId: string;
  readonly httpRequestHash: string;
  readonly normalizedArguments: unknown;
  readonly argumentHash: string;
  readonly sourceSnapshotId: string;
  readonly sourceRowIds: readonly string[];
  readonly sourceRowHashes: readonly string[];
  readonly projectionHash: string;
  readonly resultHash: string;
  readonly resultStatus: "OK" | "NOT_FOUND" | "UNAVAILABLE" | "DENIED";
  readonly snapshotIds: readonly string[];
}

export interface ConnectorWitnessObservation extends ConnectorProof {
  readonly ordinal: number;
  readonly correlationId: string;
  readonly observedAt: string;
  readonly monotonicOffsetMs: number;
}

export interface IndependentConnectorSourceEvidence {
  readonly sourceSnapshotId: string;
  readonly sourceRowIds: readonly string[];
  readonly sourceRowHashes: readonly string[];
  readonly snapshotIds: readonly string[];
}

interface ConnectorWitnessPayload extends ConnectorWitnessObservation {
  readonly eventSchemaVersion: "fastgate-connector-event-v1";
  readonly proofCommitmentSha256: string;
  readonly sourceRowsCommitmentSha256: string;
  readonly previousEventSha256: string;
  readonly eventSha256: string;
}

export type ConnectorWitnessEvent = AttestationEnvelope<ConnectorWitnessPayload>;

export function verifyConnectorHttpBindings(
  events: readonly ConnectorWitnessEvent[],
  entries: readonly TranscriptEntry[],
): boolean {
  const messages = new Map<string, TranscriptEntry>();
  for (const entry of entries) {
    if (!entry.isAgentMessage || entry.retryOfOrdinal !== null || !entry.templateId || !entry.subjectHash) continue;
    if (messages.has(entry.correlationId)) return false;
    messages.set(entry.correlationId, entry);
  }
  return events.length > 0 && events.every((event) => {
    const message = messages.get(event.payload.correlationId);
    return message !== undefined
      && event.payload.subjectHash === message.subjectHash
      && event.payload.httpTemplateId === message.templateId
      && event.payload.httpRequestHash === message.requestHash;
  });
}

export function createConnectorWitness(input: Readonly<{
  signer: EphemeralAttestationSigner;
  proofs: readonly ConnectorProof[];
}>): Readonly<{ observe(observation: ConnectorWitnessObservation): ConnectorWitnessEvent }> {
  if (input.signer.certificate.role !== "CONNECTOR_WITNESS") throw new Error("INVALID_WITNESS_ROLE");
  const proofs = new Map(input.proofs.map((proof) => [proof.proofId, Object.freeze({ ...proof })]));
  if (proofs.size !== input.proofs.length) throw new Error("DUPLICATE_CONNECTOR_PROOF");
  let previousEventSha256 = "0".repeat(64);
  let nextOrdinal = 1;

  return Object.freeze({
    observe(observation: ConnectorWitnessObservation): ConnectorWitnessEvent {
      const expected = proofs.get(observation.proofId);
      if (!expected) throw new Error("UNKNOWN_CONNECTOR_PROOF");
      if (observation.ordinal !== nextOrdinal) throw new Error("INVALID_CONNECTOR_SEQUENCE");
      assertEqual(observation.capability, expected.capability, "CONNECTOR_CAPABILITY_MISMATCH");
      assertEqual(observation.connector, expected.connector, "CONNECTOR_IDENTITY_MISMATCH");
      assertEqual(observation.operation, expected.operation, "CONNECTOR_OPERATION_MISMATCH");
      assertEqual(observation.subjectHash, expected.subjectHash, "CONNECTOR_SUBJECT_MISMATCH");
      assertEqual(observation.httpTemplateId, expected.httpTemplateId, "CONNECTOR_HTTP_BINDING_MISMATCH");
      assertEqual(observation.httpRequestHash, expected.httpRequestHash, "CONNECTOR_HTTP_BINDING_MISMATCH");
      assertEqual(canonicalJson(observation.normalizedArguments), canonicalJson(expected.normalizedArguments), "CONNECTOR_ARGUMENT_MISMATCH");
      assertEqual(observation.argumentHash, expected.argumentHash, "CONNECTOR_ARGUMENT_MISMATCH");
      assertEqual(observation.sourceSnapshotId, expected.sourceSnapshotId, "CONNECTOR_SNAPSHOT_MISMATCH");
      assertEqual(observation.projectionHash, expected.projectionHash, "CONNECTOR_PROJECTION_MISMATCH");
      assertEqual(observation.resultHash, expected.resultHash, "CONNECTOR_RESULT_MISMATCH");
      assertEqual(observation.resultStatus, expected.resultStatus, "CONNECTOR_STATUS_MISMATCH");
      assertEqual(canonicalJson(observation.sourceRowIds), canonicalJson(expected.sourceRowIds), "CONNECTOR_SOURCE_IDS_MISMATCH");
      assertEqual(canonicalJson(observation.sourceRowHashes), canonicalJson(expected.sourceRowHashes), "CONNECTOR_SOURCE_ROWS_MISMATCH");
      assertEqual(canonicalJson(observation.snapshotIds), canonicalJson(expected.snapshotIds), "CONNECTOR_SNAPSHOT_MISMATCH");
      if (!Number.isInteger(observation.ordinal) || observation.ordinal <= 0) throw new Error("INVALID_CONNECTOR_ORDINAL");
      if (!observation.correlationId.trim()) throw new Error("INVALID_CONNECTOR_CORRELATION");
      validateObservationClock(observation);
      const event = signObservation(input.signer, observation, expected, previousEventSha256);
      const eventSha256 = event.payload.eventSha256;
      previousEventSha256 = eventSha256;
      nextOrdinal += 1;
      return event;
    },
  });
}

/**
 * Signs a capability result only when its source commitment exactly matches
 * evidence selected from the witness-owned source corpus before execution.
 * Result/projection hashes bind the observed response, but they never supply
 * the source-row identity or snapshot commitment.
 */
export function createSourceBackedConnectorWitness(input: Readonly<{
  signer: EphemeralAttestationSigner;
}>): Readonly<{
  observe(
    observation: ConnectorWitnessObservation,
    independentSource: IndependentConnectorSourceEvidence,
  ): ConnectorWitnessEvent;
}> {
  if (input.signer.certificate.role !== "CONNECTOR_WITNESS") throw new Error("INVALID_WITNESS_ROLE");
  let previousEventSha256 = "0".repeat(64);
  let nextOrdinal = 1;
  return Object.freeze({
    observe(
      observation: ConnectorWitnessObservation,
      independentSource: IndependentConnectorSourceEvidence,
    ): ConnectorWitnessEvent {
      if (observation.ordinal !== nextOrdinal) throw new Error("INVALID_CONNECTOR_SEQUENCE");
      if (!Number.isInteger(observation.ordinal) || observation.ordinal <= 0) throw new Error("INVALID_CONNECTOR_ORDINAL");
      if (!observation.correlationId.trim()) throw new Error("INVALID_CONNECTOR_CORRELATION");
      validateObservationClock(observation);
      assertEqual(observation.argumentHash, sha256Hex(canonicalJson(observation.normalizedArguments)), "CONNECTOR_ARGUMENT_MISMATCH");
      if (independentSource.sourceRowIds.length === 0
        || independentSource.sourceRowIds.length !== independentSource.sourceRowHashes.length) {
        throw new Error("CONNECTOR_INDEPENDENT_SOURCE_REQUIRED");
      }
      assertEqual(observation.sourceSnapshotId, independentSource.sourceSnapshotId, "CONNECTOR_SNAPSHOT_MISMATCH");
      assertEqual(canonicalJson(observation.sourceRowIds), canonicalJson(independentSource.sourceRowIds), "CONNECTOR_SOURCE_IDS_MISMATCH");
      assertEqual(canonicalJson(observation.sourceRowHashes), canonicalJson(independentSource.sourceRowHashes), "CONNECTOR_SOURCE_ROWS_MISMATCH");
      assertEqual(canonicalJson(observation.snapshotIds), canonicalJson(independentSource.snapshotIds), "CONNECTOR_SNAPSHOT_MISMATCH");
      const proof: ConnectorProof = Object.freeze({
        proofId: observation.proofId,
        capability: observation.capability,
        connector: observation.connector,
        operation: observation.operation,
        subjectHash: observation.subjectHash,
        httpTemplateId: observation.httpTemplateId,
        httpRequestHash: observation.httpRequestHash,
        normalizedArguments: observation.normalizedArguments,
        argumentHash: observation.argumentHash,
        sourceSnapshotId: observation.sourceSnapshotId,
        sourceRowIds: Object.freeze([...observation.sourceRowIds]),
        sourceRowHashes: Object.freeze([...observation.sourceRowHashes]),
        projectionHash: observation.projectionHash,
        resultHash: observation.resultHash,
        resultStatus: observation.resultStatus,
        snapshotIds: Object.freeze([...observation.snapshotIds]),
      });
      const event = signObservation(input.signer, observation, proof, previousEventSha256);
      previousEventSha256 = event.payload.eventSha256;
      nextOrdinal += 1;
      return event;
    },
  });
}

export function verifyConnectorWitnessEvent(
  event: ConnectorWitnessEvent,
  certificate: AttestationCertificate,
  expected: ConnectorProof,
): boolean {
  if (!verifyAttestationEnvelope(event, certificate, { role: "CONNECTOR_WITNESS" })) return false;
  const payload = event.payload;
  const { eventSha256, ...eventCore } = payload;
  return payload.eventSchemaVersion === "fastgate-connector-event-v1"
    && eventSha256 === sha256Hex(canonicalJson(eventCore))
    && payload.proofId === expected.proofId
    && payload.capability === expected.capability
    && payload.connector === expected.connector
    && payload.operation === expected.operation
    && payload.subjectHash === expected.subjectHash
    && payload.httpTemplateId === expected.httpTemplateId
    && payload.httpRequestHash === expected.httpRequestHash
    && canonicalJson(payload.normalizedArguments) === canonicalJson(expected.normalizedArguments)
    && payload.argumentHash === expected.argumentHash
    && payload.argumentHash === sha256Hex(canonicalJson(payload.normalizedArguments))
    && payload.sourceSnapshotId === expected.sourceSnapshotId
    && canonicalJson(payload.sourceRowIds) === canonicalJson(expected.sourceRowIds)
    && payload.resultHash === expected.resultHash
    && payload.projectionHash === expected.projectionHash
    && payload.resultStatus === expected.resultStatus
    && canonicalJson(payload.sourceRowHashes) === canonicalJson(expected.sourceRowHashes)
    && canonicalJson(payload.snapshotIds) === canonicalJson(expected.snapshotIds)
    && payload.proofCommitmentSha256 === sha256Hex(canonicalJson(expected))
    && Number.isFinite(Date.parse(payload.observedAt))
    && Number.isFinite(payload.monotonicOffsetMs) && payload.monotonicOffsetMs >= 0
    && payload.sourceRowsCommitmentSha256 === sha256Hex(canonicalJson({
      sourceSnapshotId: expected.sourceSnapshotId,
      sourceRowIds: expected.sourceRowIds,
      sourceRowHashes: expected.sourceRowHashes,
    }));
}

function signObservation(
  signer: EphemeralAttestationSigner,
  observation: ConnectorWitnessObservation,
  proof: ConnectorProof,
  previousEventSha256: string,
): ConnectorWitnessEvent {
  const eventCore = Object.freeze({
    ...observation,
    eventSchemaVersion: "fastgate-connector-event-v1" as const,
    proofCommitmentSha256: sha256Hex(canonicalJson(proof)),
    sourceRowsCommitmentSha256: sha256Hex(canonicalJson({
      sourceSnapshotId: observation.sourceSnapshotId,
      sourceRowIds: observation.sourceRowIds,
      sourceRowHashes: observation.sourceRowHashes,
    })),
    previousEventSha256,
  });
  const eventSha256 = sha256Hex(canonicalJson(eventCore));
  return signer.sign(Object.freeze({ ...eventCore, eventSha256 }));
}

function validateObservationClock(observation: ConnectorWitnessObservation): void {
  if (!Number.isFinite(Date.parse(observation.observedAt))) throw new Error("INVALID_CONNECTOR_TIMESTAMP");
  if (!Number.isFinite(observation.monotonicOffsetMs) || observation.monotonicOffsetMs < 0) {
    throw new Error("INVALID_CONNECTOR_MONOTONIC_OFFSET");
  }
}

function assertEqual(actual: string, expected: string, error: string): void {
  if (actual !== expected) throw new Error(error);
}

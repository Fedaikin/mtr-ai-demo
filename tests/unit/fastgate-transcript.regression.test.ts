import { createEphemeralAttestationSigner } from "@/evals/fastgate/official/attestation";
import {
  createSignedTranscriptRecorder,
  verifySignedTranscript,
} from "@/evals/fastgate/official/transcript";

describe("official FastGate signed transcript", () => {
  it("commits exactly 23 ordered HTTP exchanges and closes once", () => {
    const signer = createEphemeralAttestationSigner({
      role: "HTTP_PROXY",
      runId: "run-1",
      runNonce: "1".repeat(64),
      issuedAt: "2026-08-14T12:00:00.000Z",
    });
    const recorder = createSignedTranscriptRecorder({ signer, transcriptKind: "HTTP" });
    for (let ordinal = 1; ordinal <= 23; ordinal += 1) {
      recorder.append(observation(ordinal));
    }
    const transcript = recorder.close();

    expect(verifySignedTranscript(transcript, signer.certificate, {
      expectedEntries: 23,
      expectedRunId: "run-1",
      expectedRunNonce: "1".repeat(64),
      transcriptKind: "HTTP",
      expectedAgentMessages: 23,
      expectedTemplateIds: Array.from({ length: 23 }, (_, index) => `template-${index + 1}`),
    })).toEqual({ valid: true, errors: [] });
    expect(() => recorder.append(observation(24)))
      .toThrow("TRANSCRIPT_ALREADY_CLOSED");
  });

  it("detects deletion, reorder, duplication, payload mutation, and replay", () => {
    const signer = createEphemeralAttestationSigner({
      role: "CONNECTOR_WITNESS",
      runId: "run-2",
      runNonce: "2".repeat(64),
      issuedAt: "2026-08-14T12:00:00.000Z",
    });
    const recorder = createSignedTranscriptRecorder({ signer, transcriptKind: "CONNECTOR" });
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      recorder.append(observation(ordinal));
    }
    const transcript = recorder.close();
    const variants = [
      { ...transcript, entries: transcript.entries.slice(1) },
      { ...transcript, entries: [transcript.entries[1]!, transcript.entries[0]!, transcript.entries[2]!] },
      { ...transcript, entries: [transcript.entries[0]!, transcript.entries[0]!, transcript.entries[2]!] },
      { ...transcript, entries: transcript.entries.map((entry, index) => index === 1 ? { ...entry, status: 500 } : entry) },
    ];
    for (const candidate of variants) {
      expect(verifySignedTranscript(candidate, signer.certificate, { expectedEntries: 3 }).valid).toBe(false);
    }
    expect(verifySignedTranscript(transcript, signer.certificate, { expectedRunNonce: "3".repeat(64) }).valid).toBe(false);
  });

  function observation(ordinal: number) {
    return {
      ordinal,
      startedOffsetMs: ordinal * 10,
      finishedOffsetMs: ordinal * 10 + 5,
      method: "POST" as const,
      normalizedRoute: "/api/agent/threads/:threadId/messages",
      correlationId: `correlation-${ordinal}`,
      subjectHash: "c".repeat(64),
      permissionSetHash: "d".repeat(64),
      threadIdHash: "e".repeat(64),
      messageIdHash: "f".repeat(64),
      requestHash: `${ordinal}`.padStart(64, "0"),
      responseHash: `${ordinal + 23}`.padStart(64, "0"),
      status: 200,
      templateId: `template-${ordinal}`,
      isAgentMessage: true,
      retryOfOrdinal: null,
    };
  }
});

import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import manifestJson from "../../evals/mtr-agent-fastgate-v1.json";

import { parseFastGateManifest } from "@/evals/fastgate/scoring";
import {
  assessStrictWitnessEnvironment,
  createSignedRunIdentity,
  hasExactOfficialRunSet,
  readAndVerifyRunIdentity,
  reserveFastGateScheduleEntry,
  runIdentitySha256,
  uniqueCryptographicSeeds,
  verifyRunIdentity,
  writeImmutableRunIdentity,
} from "@/evals/fastgate/supervisor";

describe("FastGate trusted supervisor contracts", () => {
  const manifest = parseFastGateManifest(manifestJson);

  it("commits exactly 23 ordered requests before the first message and signs the identity", () => {
    const identity = createIdentity();
    expect(identity.schedule).toHaveLength(23);
    expect(identity.schedule.map((item) => item.ordinal)).toEqual(Array.from({ length: 23 }, (_, index) => index + 1));
    const actualCaseOrder = [...new Set(identity.schedule.map((item) => item.caseId))];
    const expectedCaseOrder = manifest.cases
      .filter((item) => item.expectedAgentMessages > 0)
      .sort((left, right) => hash(left.id) - hash(right.id))
      .map((item) => item.id);
    expect(actualCaseOrder).toEqual(expectedCaseOrder);
    expect(verifyRunIdentity(identity)).toBe(true);
    expect(runIdentitySha256(identity)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("reserves distinct schedule slots before concurrent requests settle", () => {
    const identity = createIdentity();
    const first = reserveFastGateScheduleEntry(identity, 0);
    const second = reserveFastGateScheduleEntry(identity, 1);

    expect(first.ordinal).toBe(1);
    expect(second.ordinal).toBe(2);
    expect(first.promptTemplateId).not.toBe(second.promptTemplateId);
    expect(() => reserveFastGateScheduleEntry(identity, identity.schedule.length))
      .toThrow("FASTGATE_SCENARIO_SCHEDULE_EXHAUSTED");
  });

  it("rejects tampering and writes the commitment once as read-only", () => {
    const dir = mkdtempSync(join(tmpdir(), "fastgate-supervisor-"));
    const file = join(dir, "run-identity.json");
    const identity = createIdentity();
    writeImmutableRunIdentity(file, identity);
    expect(readAndVerifyRunIdentity(file)).toEqual(identity);
    expect(() => writeImmutableRunIdentity(file, identity)).toThrow();
    chmodSync(file, 0o600);
    const tampered = readFileSync(file, "utf8").replace(identity.seed, "f".repeat(64));
    writeFileSync(file, tampered);
    expect(() => readAndVerifyRunIdentity(file)).toThrow("INVALID_RUN_IDENTITY_SIGNATURE");
  });

  it("creates unique cryptographic seeds and rejects unsafe run counts", () => {
    const seeds = uniqueCryptographicSeeds(3);
    expect(new Set(seeds).size).toBe(3);
    expect(seeds.every((seed) => /^[a-f0-9]{64}$/u.test(seed))).toBe(true);
    expect(() => uniqueCryptographicSeeds(0)).toThrow("INVALID_RUN_COUNT");
  });

  it("forbids HIGH confidence for the current self-attested macOS diagnostic runner", () => {
    const assessment = assessStrictWitnessEnvironment();
    expect(assessment.ready).toBe(false);
    expect(assessment.blockers).toEqual(expect.arrayContaining([
      "INDEPENDENT_CONNECTOR_WITNESS_UNAVAILABLE",
      "SIGNED_HTTP_TRANSCRIPT_UNAVAILABLE",
      "DISPOSABLE_VM_OR_CONTAINER_UNAVAILABLE",
    ]));
  });

  it("accepts only exactly three unique official runs", () => {
    expect(hasExactOfficialRunSet(3, 3)).toBe(true);
    expect(hasExactOfficialRunSet(1, 1)).toBe(false);
    expect(hasExactOfficialRunSet(4, 4)).toBe(false);
    expect(hasExactOfficialRunSet(3, 2)).toBe(false);
  });

  function createIdentity() {
    return createSignedRunIdentity({
      manifest,
      seed: "a".repeat(64),
      deploymentSha: "b".repeat(40),
      sourceTreeSha256: "c".repeat(64),
      lockfileSha256: "d".repeat(64),
      manifestSha256: "e".repeat(64),
      evaluatorSha256: "f".repeat(64),
      oracleSha256: "1".repeat(64),
      sandboxProfileSha256: "2".repeat(64),
      now: "2026-08-14T00:00:00.000Z",
    });
  }

  function hash(caseId: string): number {
    return createHash("sha256").update(`${"a".repeat(64)}${caseId}`).digest().readUInt32BE(0);
  }
});

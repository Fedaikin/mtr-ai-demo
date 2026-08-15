import { createHash, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign, verify } from "node:crypto";
import { chmodSync, closeSync, fsyncSync, openSync, readFileSync, writeFileSync } from "node:fs";

import type { FastGateManifest } from "@/evals/fastgate/types";

export const FASTGATE_REQUIRED_OFFICIAL_RUNS = 3 as const;

export interface FastGateStrictWitnessAssessment {
  readonly ready: boolean;
  readonly blockers: readonly string[];
}

/**
 * The current macOS runner is useful for product diagnostics, but it is not an
 * independent witness: the runner owns the app process, mock source keys and
 * observations. Keep this assessment fail-closed until a disposable VM or
 * container provides the signed connector and HTTP transcript described by
 * FastGate sections 5.4.1-5.4.2.
 */
export function assessStrictWitnessEnvironment(): FastGateStrictWitnessAssessment {
  return Object.freeze({
    ready: false,
    blockers: Object.freeze([
      "INDEPENDENT_CONNECTOR_WITNESS_UNAVAILABLE",
      "SIGNED_HTTP_TRANSCRIPT_UNAVAILABLE",
      "DETACHED_READ_ONLY_BUILD_ATTESTATION_UNAVAILABLE",
      "DISPOSABLE_VM_OR_CONTAINER_UNAVAILABLE",
      "COUNTERFACTUAL_OVERLAY_WITNESS_UNAVAILABLE",
    ]),
  });
}

export function hasExactOfficialRunSet(
  runCount: number,
  uniqueSeedCount: number,
): boolean {
  return runCount === FASTGATE_REQUIRED_OFFICIAL_RUNS && uniqueSeedCount === FASTGATE_REQUIRED_OFFICIAL_RUNS;
}

export interface FastGateRunIdentity {
  readonly schemaVersion: "fastgate-run-identity-v1";
  readonly runId: string;
  readonly seed: string;
  readonly deploymentSha: string;
  readonly sourceTreeSha256: string;
  readonly lockfileSha256: string;
  readonly manifestVersion: string;
  readonly manifestSha256: string;
  readonly evaluatorSha256: string;
  readonly oracleSha256: string;
  readonly selectionCommitmentSha256: string;
  readonly createdBeforeFirstMessageAt: string;
  readonly schedule: readonly Readonly<{
    caseId: string;
    promptTemplateId: string;
    ordinal: number;
  }>[];
  readonly sandboxProfileSha256: string;
  readonly attestationRootKeyId: string;
  readonly attestationRootPublicKeyPem: string;
  readonly publicKey: string;
  readonly signature: string;
}

type UnsignedRunIdentity = Omit<FastGateRunIdentity, "publicKey" | "signature">;

export function createSignedRunIdentity(input: Readonly<{
  runId?: string;
  manifest: FastGateManifest;
  seed: string;
  deploymentSha: string;
  sourceTreeSha256: string;
  lockfileSha256: string;
  manifestSha256: string;
  evaluatorSha256: string;
  oracleSha256: string;
  sandboxProfileSha256: string;
  attestationRootKeyId?: string;
  attestationRootPublicKeyPem?: string;
  now?: string;
}>): FastGateRunIdentity {
  const orderedCases = [...input.manifest.cases].sort((left, right) =>
    hashOrder(input.seed, left.id) - hashOrder(input.seed, right.id));
  const schedule = orderedCases.flatMap((caseDefinition) =>
    Array.from({ length: caseDefinition.expectedAgentMessages }, (_, index) => ({
      caseId: caseDefinition.id,
      promptTemplateId: `${caseDefinition.id}:${String(index + 1).padStart(2, "0")}`,
      ordinal: 0,
    })))
    .map((item, index) => ({ ...item, ordinal: index + 1 }));
  if (schedule.length !== input.manifest.expectedAgentMessages) throw new Error("INVALID_SCENARIO_SCHEDULE");
  const selectionCommitmentSha256 = sha256(canonicalJson({
    schemaVersion: "fastgate-selection-commitment-v1",
    seed: input.seed,
    deploymentSha: input.deploymentSha,
    manifestSha256: input.manifestSha256,
    orderedPromptTemplateIds: schedule.map((item) => item.promptTemplateId),
  }));
  const unsigned: UnsignedRunIdentity = {
    schemaVersion: "fastgate-run-identity-v1",
    runId: input.runId ?? randomUUID(),
    seed: input.seed,
    deploymentSha: input.deploymentSha,
    sourceTreeSha256: input.sourceTreeSha256,
    lockfileSha256: input.lockfileSha256,
    manifestVersion: input.manifest.manifestVersion,
    manifestSha256: input.manifestSha256,
    evaluatorSha256: input.evaluatorSha256,
    oracleSha256: input.oracleSha256,
    selectionCommitmentSha256,
    createdBeforeFirstMessageAt: input.now ?? new Date().toISOString(),
    schedule,
    sandboxProfileSha256: input.sandboxProfileSha256,
    attestationRootKeyId: input.attestationRootKeyId ?? "UNATTESTED",
    attestationRootPublicKeyPem: input.attestationRootPublicKeyPem ?? "UNATTESTED",
  };
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return Object.freeze({
    ...unsigned,
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    signature: sign(null, Buffer.from(canonicalJson(unsigned)), privateKey).toString("base64url"),
  });
}

function hashOrder(seed: string, caseId: string): number {
  return createHash("sha256").update(`${seed}${caseId}`).digest().readUInt32BE(0);
}

export function verifyRunIdentity(identity: FastGateRunIdentity): boolean {
  const { publicKey, signature, ...unsigned } = identity;
  try {
    return verify(
      null,
      Buffer.from(canonicalJson(unsigned)),
      createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" }),
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

export function writeImmutableRunIdentity(path: string, identity: FastGateRunIdentity): void {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(identity, null, 2)}\n`, { encoding: "utf8" });
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(path, 0o400);
}

export function readAndVerifyRunIdentity(path: string): FastGateRunIdentity {
  const value = JSON.parse(readFileSync(path, "utf8")) as FastGateRunIdentity;
  if (!verifyRunIdentity(value)) throw new Error("INVALID_RUN_IDENTITY_SIGNATURE");
  if (value.schedule.length !== 23 || value.schedule.some((item, index) => item.ordinal !== index + 1)) {
    throw new Error("INVALID_SCENARIO_SCHEDULE");
  }
  return value;
}

export function reserveFastGateScheduleEntry(
  identity: FastGateRunIdentity,
  messageIndex: number,
): FastGateRunIdentity["schedule"][number] {
  const entry = identity.schedule[messageIndex];
  if (!entry) throw new Error("FASTGATE_SCENARIO_SCHEDULE_EXHAUSTED");
  return entry;
}

export function uniqueCryptographicSeeds(count: number): readonly string[] {
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error("INVALID_RUN_COUNT");
  const seeds = new Set<string>();
  while (seeds.size < count) seeds.add(randomBytes(32).toString("hex"));
  return Object.freeze([...seeds]);
}

export function runIdentitySha256(identity: FastGateRunIdentity): string {
  return sha256(canonicalJson(identity));
}

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("NON_FINITE_JSON_NUMBER");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error("UNSUPPORTED_JSON_VALUE");
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

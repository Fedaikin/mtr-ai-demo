import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

export interface SourceBindingEnvelope {
  readonly schemaVersion: "agent-source-binding-v1";
  readonly capabilityKey: string;
  readonly requestId: string;
  readonly subjectIdHash: string;
  readonly connector: "APPIUS" | "SAP" | "PROCESS_ENGINE" | "NORMATIVE";
  readonly resultStatus: "SUCCESS" | "PARTIAL" | "DENIED" | "NOT_FOUND";
  readonly canonicalArgumentsHash: string;
  readonly sourceProjectionHash: string;
  readonly sourceBindingHash: string;
  readonly snapshotIds: readonly string[];
  readonly citationEntityIds: readonly string[];
  /** Compatibility aliases retained for existing audit consumers. */
  readonly inputHash: string;
  readonly outputHash: string;
  readonly sourceSnapshots: readonly string[];
  readonly rowCount: number;
  readonly publicKeyId: string | null;
  readonly signature: string | null;
}

export function createSourceBinding(input: Readonly<{
  capabilityKey: string;
  requestId: string;
  subjectId: string;
  connector: SourceBindingEnvelope["connector"];
  resultStatus: SourceBindingEnvelope["resultStatus"];
  deploymentSha: string;
  datasetFingerprint: string;
  input: unknown;
  output: unknown;
  privateKey?: KeyObject | string | null;
  publicKey?: KeyObject | string | null;
}>): SourceBindingEnvelope {
  const snapshotIds = collectSourceSnapshots(input.output);
  const citationEntityIds = collectCitationEntityIds(input.output);
  const canonicalArgumentsHash = sha256(canonicalProjectionJson(input.input));
  const sourceProjectionHash = sha256(canonicalProjectionJson({
    schemaVersion: "agent-source-projection-v1",
    deploymentSha: input.deploymentSha,
    datasetFingerprint: input.datasetFingerprint,
    capability: input.capabilityKey,
    subjectScopeHash: sha256(input.subjectId.normalize("NFC")),
    canonicalArguments: input.input,
    snapshotIds,
    rows: input.output,
  }));
  const bindingFields = {
    schemaVersion: "agent-source-binding-v1" as const,
    capabilityKey: input.capabilityKey,
    requestId: input.requestId,
    subjectIdHash: sha256(input.subjectId.normalize("NFC")),
    connector: input.connector,
    resultStatus: input.resultStatus,
    canonicalArgumentsHash,
    sourceProjectionHash,
    snapshotIds,
    citationEntityIds,
    inputHash: canonicalArgumentsHash,
    outputHash: sourceProjectionHash,
    sourceSnapshots: snapshotIds,
    rowCount: countRows(input.output),
  };
  const unsigned = { ...bindingFields, sourceBindingHash: sha256(canonicalJson(bindingFields)) };
  const privateKey = toPrivateKey(input.privateKey);
  const publicKey = toPublicKey(input.publicKey);
  if (!privateKey || !publicKey) {
    return Object.freeze({ ...unsigned, publicKeyId: null, signature: null });
  }
  return Object.freeze({
    ...unsigned,
    publicKeyId: sourceBindingPublicKeyId(publicKey),
    signature: sign(null, Buffer.from(canonicalJson(unsigned)), privateKey).toString("base64url"),
  });
}

export function verifySourceBinding(
  binding: SourceBindingEnvelope,
  publicKeyInput: KeyObject | string,
): boolean {
  const publicKey = toPublicKey(publicKeyInput);
  if (!publicKey || !binding.signature || binding.publicKeyId !== sourceBindingPublicKeyId(publicKey)) return false;
  const unsigned = {
    schemaVersion: binding.schemaVersion,
    capabilityKey: binding.capabilityKey,
    requestId: binding.requestId,
    subjectIdHash: binding.subjectIdHash,
    connector: binding.connector,
    resultStatus: binding.resultStatus,
    canonicalArgumentsHash: binding.canonicalArgumentsHash,
    sourceProjectionHash: binding.sourceProjectionHash,
    snapshotIds: binding.snapshotIds,
    citationEntityIds: binding.citationEntityIds,
    inputHash: binding.inputHash,
    outputHash: binding.outputHash,
    sourceSnapshots: binding.sourceSnapshots,
    rowCount: binding.rowCount,
  };
  const expectedBindingHash = sha256(canonicalJson(unsigned));
  if (binding.sourceBindingHash !== expectedBindingHash) return false;
  const signed = { ...unsigned, sourceBindingHash: binding.sourceBindingHash };
  return verify(
    null,
    Buffer.from(canonicalJson(signed)),
    publicKey,
    Buffer.from(binding.signature, "base64url"),
  );
}

export function sourceBindingPublicKeyId(publicKeyInput: KeyObject | string): string {
  const publicKey = toPublicKey(publicKeyInput);
  if (!publicKey) throw new Error("SOURCE_BINDING_PUBLIC_KEY_INVALID");
  return sha256(publicKey.export({ type: "spki", format: "der" }));
}

/** RFC 8785-compatible for the JSON values emitted by capability schemas. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("SOURCE_BINDING_NON_FINITE_NUMBER");
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
  throw new Error("SOURCE_BINDING_UNSUPPORTED_VALUE");
}

/** Source projections deliberately sort arrays by their canonical row tuple. */
export function canonicalProjectionJson(value: unknown): string {
  if (Array.isArray(value)) {
    const items = value.map(canonicalProjectionJson).sort();
    return `[${items.join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalProjectionJson(item)}`)
      .join(",")}}`;
  }
  return canonicalJson(value);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function toPrivateKey(value: KeyObject | string | null | undefined): KeyObject | null {
  if (!value) return null;
  if (typeof value !== "string") return value;
  try {
    return createPrivateKey({ key: Buffer.from(value, "base64"), format: "der", type: "pkcs8" });
  } catch {
    return null;
  }
}

function toPublicKey(value: KeyObject | string | null | undefined): KeyObject | null {
  if (!value) return null;
  if (typeof value !== "string") return value;
  try {
    return createPublicKey({ key: Buffer.from(value, "base64"), format: "der", type: "spki" });
  } catch {
    return null;
  }
}

function collectSourceSnapshots(value: unknown): readonly string[] {
  const snapshots = new Set<string>();
  visit(value, (key, item) => {
    if (typeof item === "string" && /(?:snapshot|version|datasetVersion)$/iu.test(key)) snapshots.add(item);
  });
  return Object.freeze([...snapshots].sort());
}

function collectCitationEntityIds(value: unknown): readonly string[] {
  const identifiers = new Set<string>();
  visit(value, (key, item) => {
    if (typeof item === "string" && /(?:entityId|materialCode|projectId|specificationId)$/u.test(key)) identifiers.add(item);
  });
  return Object.freeze([...identifiers].sort());
}

function countRows(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object") return value === null ? 0 : 1;
  const record = value as Record<string, unknown>;
  for (const key of ["rows", "items", "materials", "projects", "positions"]) {
    if (Array.isArray(record[key])) return record[key].length;
  }
  return 1;
}

function visit(value: unknown, visitor: (key: string, value: unknown) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, visitor);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    visitor(key, item);
    visit(item, visitor);
  }
}

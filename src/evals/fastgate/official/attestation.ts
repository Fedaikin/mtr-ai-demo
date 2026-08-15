import {
  createHash,
  generateKeyPairSync,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";

export type FastGateAttestationRole =
  | "SUPERVISOR"
  | "HTTP_PROXY"
  | "CONNECTOR_WITNESS"
  | "OFFLINE_VERIFIER"
  | "READ_ONLY_REVIEWER";

export interface AttestationCertificate {
  readonly schemaVersion: "mtr-fastgate-attestation-certificate-v1";
  readonly role: FastGateAttestationRole;
  readonly runId: string;
  readonly runNonce: string;
  readonly issuedAt: string;
  readonly keyId: string;
  readonly publicKeyPem: string;
}

export interface AttestationEnvelope<T = unknown> {
  readonly schemaVersion: "mtr-fastgate-attestation-envelope-v1";
  readonly role: FastGateAttestationRole;
  readonly runId: string;
  readonly runNonce: string;
  readonly keyId: string;
  readonly payloadSha256: string;
  readonly payload: T;
  readonly signatureBase64: string;
}

export interface EphemeralAttestationSigner {
  readonly certificate: AttestationCertificate;
  sign<T>(payload: T): AttestationEnvelope<T>;
}

export interface IssuedComponentCertificatePayload {
  readonly schemaVersion: "mtr-fastgate-issued-component-certificate-v1";
  readonly componentCertificate: AttestationCertificate;
  readonly imageDigest: string;
  readonly rootKeyId: string;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createEphemeralAttestationSigner(input: Readonly<{
  role: FastGateAttestationRole;
  runId: string;
  runNonce: string;
  issuedAt: string;
}>): EphemeralAttestationSigner {
  assertIdentifier(input.runId, "INVALID_RUN_ID");
  if (!/^[a-f0-9]{64}$/u.test(input.runNonce)) throw new Error("INVALID_RUN_NONCE");
  if (!Number.isFinite(Date.parse(input.issuedAt))) throw new Error("INVALID_ISSUED_AT");

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const keyId = sha256Hex(publicKey.export({ format: "der", type: "spki" }));
  const certificate: AttestationCertificate = Object.freeze({
    schemaVersion: "mtr-fastgate-attestation-certificate-v1",
    role: input.role,
    runId: input.runId,
    runNonce: input.runNonce,
    issuedAt: input.issuedAt,
    keyId,
    publicKeyPem,
  });

  return Object.freeze({
    certificate,
    sign<T>(payload: T): AttestationEnvelope<T> {
      const payloadSha256 = sha256Hex(canonicalJson(payload));
      const unsigned = {
        schemaVersion: "mtr-fastgate-attestation-envelope-v1" as const,
        role: certificate.role,
        runId: certificate.runId,
        runNonce: certificate.runNonce,
        keyId: certificate.keyId,
        payloadSha256,
      };
      const signatureBase64 = signBytes(null, Buffer.from(canonicalJson(unsigned)), privateKey).toString("base64");
      return Object.freeze({ ...unsigned, payload, signatureBase64 });
    },
  });
}

export function verifyAttestationEnvelope(
  envelope: AttestationEnvelope,
  certificate: AttestationCertificate,
  expected: Partial<Pick<AttestationCertificate, "role" | "runId" | "runNonce" | "keyId">> = {},
): boolean {
  try {
    if (envelope.schemaVersion !== "mtr-fastgate-attestation-envelope-v1") return false;
    if (certificate.schemaVersion !== "mtr-fastgate-attestation-certificate-v1") return false;
    if (envelope.role !== certificate.role || envelope.runId !== certificate.runId) return false;
    if (envelope.runNonce !== certificate.runNonce || envelope.keyId !== certificate.keyId) return false;
    for (const [key, value] of Object.entries(expected)) {
      if (value !== undefined && certificate[key as keyof AttestationCertificate] !== value) return false;
    }
    const payloadSha256 = sha256Hex(canonicalJson(envelope.payload));
    if (payloadSha256 !== envelope.payloadSha256) return false;
    const unsigned = {
      schemaVersion: envelope.schemaVersion,
      role: envelope.role,
      runId: envelope.runId,
      runNonce: envelope.runNonce,
      keyId: envelope.keyId,
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

export function issueComponentCertificate(
  supervisor: EphemeralAttestationSigner,
  componentCertificate: AttestationCertificate,
  imageDigest: string,
): AttestationEnvelope<IssuedComponentCertificatePayload> {
  if (supervisor.certificate.role !== "SUPERVISOR") throw new Error("SUPERVISOR_SIGNER_REQUIRED");
  if (componentCertificate.role === "SUPERVISOR") throw new Error("COMPONENT_ROLE_REQUIRED");
  if (componentCertificate.runId !== supervisor.certificate.runId || componentCertificate.runNonce !== supervisor.certificate.runNonce) {
    throw new Error("COMPONENT_CERTIFICATE_SCOPE_MISMATCH");
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(imageDigest)) throw new Error("INVALID_COMPONENT_IMAGE_DIGEST");
  return supervisor.sign(Object.freeze({
    schemaVersion: "mtr-fastgate-issued-component-certificate-v1",
    componentCertificate,
    imageDigest,
    rootKeyId: supervisor.certificate.keyId,
  }));
}

export function verifyIssuedComponentCertificate(
  issued: AttestationEnvelope<IssuedComponentCertificatePayload>,
  supervisorCertificate: AttestationCertificate,
  componentCertificate: AttestationCertificate,
  expected: Partial<Readonly<{ role: FastGateAttestationRole; imageDigest: string }>> = {},
): boolean {
  if (supervisorCertificate.role !== "SUPERVISOR") return false;
  if (!verifyAttestationEnvelope(issued, supervisorCertificate, { role: "SUPERVISOR" })) return false;
  const payload = issued.payload;
  return payload.schemaVersion === "mtr-fastgate-issued-component-certificate-v1"
    && payload.rootKeyId === supervisorCertificate.keyId
    && canonicalJson(payload.componentCertificate) === canonicalJson(componentCertificate)
    && payload.componentCertificate.runId === supervisorCertificate.runId
    && payload.componentCertificate.runNonce === supervisorCertificate.runNonce
    && (expected.role === undefined || componentCertificate.role === expected.role)
    && (expected.imageDigest === undefined || payload.imageDigest === expected.imageDigest);
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("NON_CANONICAL_NUMBER");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => {
      if (record[key] === undefined) throw new Error("UNSUPPORTED_CANONICAL_VALUE");
      return [key.normalize("NFC"), canonicalValue(record[key])];
    }));
  }
  throw new Error("UNSUPPORTED_CANONICAL_VALUE");
}

function assertIdentifier(value: string, error: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(value)) throw new Error(error);
}

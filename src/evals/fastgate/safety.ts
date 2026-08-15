import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

export interface FastGateReleaseMetadata {
  readonly environment: "PREVIEW";
  readonly deploymentUrl: string;
  readonly gitSha: string;
  readonly datasetVersion: string;
  readonly promptVersion: string;
  readonly databaseFingerprint: string;
  readonly actionExecutionMode: "PROPOSE_ONLY" | "DISABLED";
}

export interface FastGateDatabaseMarker {
  readonly environment: "PREVIEW";
  readonly deploymentSha: string;
  readonly datasetVersion: string;
  readonly databaseFingerprint: string;
  readonly allowFastGate: true;
}

export interface FastGatePreflight {
  readonly mode: "LOCAL" | "PREVIEW";
  readonly origin: string;
  readonly deploymentSha: string;
  readonly release: FastGateReleaseMetadata | null;
  readonly databaseAttested: boolean;
  readonly directOracleAllowed: boolean;
  readonly actionProposalAllowed: boolean;
  readonly runtimeLimitMs: number;
}

const releaseSchema = z.object({
  environment: z.literal("PREVIEW"),
  deploymentUrl: z.string().url(),
  gitSha: z.string().regex(/^[a-f0-9]{40}$/u),
  datasetVersion: z.string().min(1).max(100),
  promptVersion: z.string().min(1).max(100),
  databaseFingerprint: z.string().regex(/^[a-f0-9]{32,128}$/u),
  actionExecutionMode: z.enum(["PROPOSE_ONLY", "DISABLED"]),
}).strict();

const markerSchema = z.object({
  environment: z.literal("PREVIEW"),
  deploymentSha: z.string().regex(/^[a-f0-9]{40}$/u),
  datasetVersion: z.string().min(1).max(100),
  databaseFingerprint: z.string().regex(/^[a-f0-9]{32,128}$/u),
  allowFastGate: z.literal(true),
}).strict();

export function fastGatePreflight(
  env: Readonly<Record<string, string | undefined>>,
  localSha: string,
  databaseMarker?: unknown,
): FastGatePreflight {
  if (env.FASTGATE_CONTAINER_OFFICIAL === "1") {
    if (env.FASTGATE_OFFICIAL !== "1" || env.FASTGATE_SUPERVISED !== "true") {
      throw new FastGateSafetyError("OFFICIAL_CONTAINER_ATTESTATION_REQUIRED");
    }
    if (env.FASTGATE_INTERNAL_ORIGIN !== "http://http-proxy:4310") {
      throw new FastGateSafetyError("OFFICIAL_INTERNAL_ORIGIN_FORBIDDEN");
    }
    if (env.DATABASE_URL?.trim()) throw new FastGateSafetyError("OFFICIAL_REMOTE_DATABASE_FORBIDDEN");
    return {
      mode: "LOCAL",
      origin: env.FASTGATE_INTERNAL_ORIGIN,
      deploymentSha: localSha,
      release: null,
      databaseAttested: true,
      directOracleAllowed: false,
      actionProposalAllowed: true,
      runtimeLimitMs: 900_000,
    };
  }
  const target = env.PLAYWRIGHT_BASE_URL?.trim();
  if (!target) {
    const port = Number(env.PORT ?? 3187);
    if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new FastGateSafetyError("INVALID_LOCAL_PORT");
    return {
      mode: "LOCAL",
      origin: `http://127.0.0.1:${port}`,
      deploymentSha: localSha,
      release: null,
      databaseAttested: true,
      directOracleAllowed: true,
      actionProposalAllowed: true,
      runtimeLimitMs: 600_000,
    };
  }

  if (env.FASTGATE_ALLOW_PREVIEW !== "true") throw new FastGateSafetyError("PREVIEW_NOT_EXPLICITLY_ALLOWED");
  const url = parseOrigin(target);
  if (url.protocol !== "https:") throw new FastGateSafetyError("PREVIEW_REQUIRES_HTTPS");
  if (isProductionAlias(url.hostname, env)) throw new FastGateSafetyError("PRODUCTION_TARGET_FORBIDDEN");
  const releaseFile = env.FASTGATE_RELEASE_METADATA_FILE?.trim();
  if (!releaseFile) throw new FastGateSafetyError("RELEASE_METADATA_REQUIRED");
  const release = readSecureJsonFile(releaseFile, releaseSchema);
  if (new URL(release.deploymentUrl).origin !== url.origin) throw new FastGateSafetyError("DEPLOYMENT_ORIGIN_MISMATCH");
  if (env.FASTGATE_EXPECTED_DEPLOYMENT_SHA && env.FASTGATE_EXPECTED_DEPLOYMENT_SHA !== release.gitSha) {
    throw new FastGateSafetyError("DEPLOYMENT_SHA_MISMATCH");
  }

  const allowlist = new Set((env.FASTGATE_ALLOWED_PREVIEW_DATABASE_FINGERPRINTS ?? "")
    .split(",").map((item) => item.trim()).filter(Boolean));
  const marker = databaseMarker === undefined ? null : markerSchema.parse(databaseMarker);
  const databaseAttested = Boolean(
    marker
    && allowlist.has(release.databaseFingerprint)
    && marker.databaseFingerprint === release.databaseFingerprint
    && marker.deploymentSha === release.gitSha
    && marker.datasetVersion === release.datasetVersion,
  );
  return {
    mode: "PREVIEW",
    origin: url.origin,
    deploymentSha: release.gitSha,
    release,
    databaseAttested,
    directOracleAllowed: databaseAttested && Boolean(env.FASTGATE_DATABASE_URL?.trim()),
    actionProposalAllowed: databaseAttested && release.actionExecutionMode === "PROPOSE_ONLY",
    runtimeLimitMs: 900_000,
  };
}

export type FastGateHttpMethod = "GET" | "HEAD" | "OPTIONS" | "POST" | "PUT" | "PATCH" | "DELETE";

export function assertFastGateRequestAllowed(
  origin: string,
  input: string | URL,
  method: FastGateHttpMethod,
  body?: unknown,
  cancellableProposalId?: string,
): void {
  const url = new URL(input, origin);
  if (url.origin !== origin) throw new FastGateSafetyError("CROSS_ORIGIN_REQUEST_BLOCKED");
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  if (method !== "POST") throw new FastGateSafetyError("UNEXPECTED_MUTATION_ATTEMPT");
  const path = url.pathname;
  if (path === "/api/auth/login" || path === "/api/agent/threads") return;
  if (/^\/api\/agent\/threads\/[^/]+\/messages$/u.test(path)) return;
  if (path === "/api/agent/actions") {
    proposalOnlySchema.parse(body);
    return;
  }
  const cancel = path.match(/^\/api\/agent\/actions\/([^/]+)\/cancel$/u);
  if (cancel && cancellableProposalId && decodeURIComponent(cancel[1]!) === cancellableProposalId) return;
  throw new FastGateSafetyError("UNEXPECTED_MUTATION_ATTEMPT");
}

const proposalOnlySchema = z.object({
  schemaVersion: z.literal("fastgate-proposal-only-v1"),
  operation: z.literal("PROPOSE"),
  execute: z.literal(false),
  caseId: z.string().min(1).max(200),
  target: z.object({ type: z.literal("SYNTHETIC_USER"), id: z.string().min(1).max(200) }).strict(),
  actionType: z.string().min(1).max(100),
  idempotencyKey: z.string().uuid(),
}).strict();

export function assertCredentialsFileSafe(path: string): void {
  const stat = lstatSync(resolve(path));
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new FastGateSafetyError("CREDENTIALS_FILE_PERMISSIONS");
}

function readSecureJsonFile<T>(path: string, schema: z.ZodType<T>): T {
  assertCredentialsFileSafe(path);
  return schema.parse(JSON.parse(readFileSync(resolve(path), "utf8")));
}

function parseOrigin(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== "/" && url.pathname !== "" || url.search || url.hash) {
    throw new FastGateSafetyError("PLAYWRIGHT_BASE_URL_MUST_BE_ORIGIN");
  }
  return url;
}

function isProductionAlias(hostname: string, env: Readonly<Record<string, string | undefined>>): boolean {
  const explicit = (env.FASTGATE_PRODUCTION_HOSTNAMES ?? "mtr-ai-demo.vercel.app")
    .split(",").map((item) => item.trim().toLocaleLowerCase("en-US")).filter(Boolean);
  return explicit.includes(hostname.toLocaleLowerCase("en-US"));
}

export class FastGateSafetyError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "FastGateSafetyError";
  }
}

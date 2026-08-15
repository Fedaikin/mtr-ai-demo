import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

import { initializeDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { createUniversalAgentReadPort } from "@/adapters/persistence/universal-agent-read-port";
import { resolveAuthorizationContext } from "@/application/authorization-service";
import {
  UNIVERSAL_READ_CAPABILITY_SCHEMAS,
  type UniversalReadCapabilityKey,
} from "@/application/agent-orchestrator/universal-chat/capability-registry";
import { createUniversalReadCapabilityRegistry } from "@/application/agent-orchestrator/universal-chat/read-capabilities";
import { createAgentExecutionContext } from "@/domain/agent/context";
import {
  canonicalJson,
  createEphemeralAttestationSigner,
  sha256Hex,
  verifyIssuedComponentCertificate,
  type AttestationCertificate,
  type AttestationEnvelope,
  type IssuedComponentCertificatePayload,
} from "@/evals/fastgate/official/attestation";
import {
  createSourceBackedConnectorWitness,
  type ConnectorProof,
  type ConnectorWitnessEvent,
} from "@/evals/fastgate/official/connector-witness";
import { applyDatabaseCounterfactualOverlay } from "@/evals/fastgate/official/database-overlay";
import { selectIndependentSourceEvidence } from "@/evals/fastgate/official/independent-source-evidence";
import { prepareLocalFastGateFixture } from "@/evals/fastgate/local-fixture";
import { buildLocalFastGateOracle } from "@/evals/fastgate/reference-oracle";

interface RunContext {
  readonly schemaVersion: "mtr-fastgate-witness-context-v1";
  readonly runId: string;
  readonly runNonce: string;
  readonly witnessControlToken: string;
  readonly witnessGatewayToken: string;
  readonly startedAt: string;
  readonly supervisorCertificate: AttestationCertificate;
}

const fixtureSchema = z.object({
  schemaVersion: z.literal("mtr-fastgate-application-fixture-v1"),
  overlaySeed: z.string().regex(/^[a-f0-9]{64}$/u),
  scenarioInstant: z.string().datetime(),
  datasetVersion: z.string().min(1),
  publicFixture: z.record(z.string(), z.unknown()),
}).strict();

const requestSchema = z.object({
  capabilityKey: z.string().min(1),
  input: z.unknown(),
  context: z.object({
    subjectId: z.string().trim().min(1).max(200),
    activeProjectId: z.string().trim().min(1).max(200).nullable(),
    authorizationVersion: z.number().int().positive(),
    correlationId: z.string().trim().min(1).max(200),
  }).strict(),
}).strict();

async function main(): Promise<void> {
  assertWitnessEnvironment();
  const port = boundedPort(process.env.FASTGATE_WITNESS_PORT ?? "4320");
  const artifactDir = resolve(requiredEnv("FASTGATE_ARTIFACT_DIR"));
  const privateDir = resolve(requiredEnv("FASTGATE_PRIVATE_DIR"));
  const controlDir = resolve(requiredEnv("FASTGATE_CONTROL_DIR"));
  const context = await waitForJson<RunContext>(join(controlDir, "witness-context.json"));
  const fixture = fixtureSchema.parse(await waitForJson<unknown>(resolve(requiredEnv("FASTGATE_PUBLIC_FIXTURE_PATH"))));

  const signer = createEphemeralAttestationSigner({
    role: "CONNECTOR_WITNESS",
    runId: context.runId,
    runNonce: context.runNonce,
    issuedAt: context.startedAt,
  });
  for (const directory of [artifactDir, privateDir]) mkdirSync(directory, { recursive: true });
  writeFileSync(join(artifactDir, "connector-witness-certificate.json"), `${JSON.stringify(signer.certificate, null, 2)}\n`, { mode: 0o600 });
  const issuedCertificate = await waitForJson<AttestationEnvelope<IssuedComponentCertificatePayload>>(
    join(controlDir, "issued-connector-witness-certificate.json"),
  );
  if (!verifyIssuedComponentCertificate(
    issuedCertificate,
    context.supervisorCertificate,
    signer.certificate,
    {
      role: "CONNECTOR_WITNESS",
      imageDigest: requiredDigest("FASTGATE_WITNESS_IMAGE_DIGEST"),
    },
  )) throw new Error("FASTGATE_WITNESS_CERTIFICATE_CHAIN_INVALID");
  writeFileSync(join(artifactDir, "supervisor-certificate.json"), `${JSON.stringify(context.supervisorCertificate, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(artifactDir, "issued-connector-witness-certificate.json"), `${JSON.stringify(issuedCertificate, null, 2)}\n`, { mode: 0o600 });

  await initializeDatabase();
  const database = await getDatabase({ migrations: "skip" });
  const overlay = await applyDatabaseCounterfactualOverlay(database, {
    seed: fixture.overlaySeed,
    scenarioInstant: fixture.scenarioInstant,
  });
  await prepareLocalFastGateFixture(requiredEnv("FASTGATE_FIXTURE_RUN_ID"));
  const oracle = await buildLocalFastGateOracle(requiredEnv("FASTGATE_DEPLOYMENT_SHA"));
  const registry = createUniversalReadCapabilityRegistry(createUniversalAgentReadPort(database));

  const witness = createSourceBackedConnectorWitness({ signer });
  const events: ConnectorWitnessEvent[] = [];
  const monotonicStart = performance.now();
  let closed = false;

  writeFileSync(join(privateDir, "oracle.json"), `${JSON.stringify(oracle, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(privateDir, "database-overlay-applied.json"), `${JSON.stringify(overlay, null, 2)}\n`, { mode: 0o600 });

  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/__fastgate/control/events") {
        if (request.method !== "GET" || stringHeader(request, "x-fastgate-control-token") !== context.witnessControlToken) {
          json(response, 403, { error: "FASTGATE_CONTROL_DENIED" });
          return;
        }
        json(response, 200, {
          supervisorCertificate: context.supervisorCertificate,
          issuedCertificate,
          certificate: signer.certificate,
          events,
        });
        return;
      }
      if (request.url === "/__fastgate/control/close") {
        if (request.method !== "POST" || stringHeader(request, "x-fastgate-control-token") !== context.witnessControlToken) {
          json(response, 403, { error: "FASTGATE_CONTROL_DENIED" });
          return;
        }
        await closeTranscript();
        json(response, 200, { closed: true, eventCount: events.length });
        return;
      }
      if (request.url !== "/v1/capability" || request.method !== "POST") {
        json(response, 404, { error: "FASTGATE_WITNESS_ROUTE_NOT_FOUND" });
        return;
      }
      if (closed) {
        json(response, 503, { error: "FASTGATE_CONNECTOR_TRANSCRIPT_CLOSED" });
        return;
      }
      if (stringHeader(request, "x-fastgate-witness-gateway-token") !== context.witnessGatewayToken) {
        json(response, 403, { error: "FASTGATE_WITNESS_GATEWAY_REQUIRED" });
        return;
      }
      const httpTemplateId = requiredHeader(request, "x-fastgate-http-template-id", /^[A-Z0-9-]+:\d{2}$/u);
      const httpRequestHash = requiredHeader(request, "x-fastgate-http-request-hash", /^[a-f0-9]{64}$/u);
      const httpSubjectHash = requiredHeader(request, "x-fastgate-http-subject-hash", /^[a-f0-9]{64}$/u);
      const body = requestSchema.parse(await readJson<unknown>(request, 1_000_000));
      if (!(body.capabilityKey in UNIVERSAL_READ_CAPABILITY_SCHEMAS)) {
        throw new Error("FASTGATE_WITNESS_CAPABILITY_UNKNOWN");
      }
      const capabilityKey = body.capabilityKey as UniversalReadCapabilityKey;
      const trusted = await resolveAuthorizationContext(body.context.subjectId, body.context.activeProjectId);
      if (sha256Hex(trusted.subjectId) !== httpSubjectHash) throw new Error("FASTGATE_WITNESS_SUBJECT_BINDING_MISMATCH");
      if (
        trusted.authorizationVersion !== body.context.authorizationVersion
        || trusted.activeProjectId !== body.context.activeProjectId
      ) {
        throw new Error("FASTGATE_WITNESS_CONTEXT_STALE");
      }
      const executionContext = createAgentExecutionContext(trusted, {
        correlationId: body.context.correlationId,
        selection: body.context.activeProjectId ? { projectId: body.context.activeProjectId } : {},
      });
      const input = UNIVERSAL_READ_CAPABILITY_SCHEMAS[capabilityKey].parse(body.input);
      const independentSource = selectIndependentSourceEvidence({
        oracle,
        capabilityKey,
        capabilityInput: input,
      });
      const output = await registry.execute(capabilityKey, executionContext, input);
      const proof = proofFromIndependentSource({
        capabilityKey,
        subjectId: trusted.subjectId,
        correlationId: body.context.correlationId,
        httpTemplateId,
        httpRequestHash,
        input,
        output,
        ordinal: events.length + 1,
        independentSource,
      });
      events.push(witness.observe(
        {
          ...proof,
          ordinal: events.length + 1,
          correlationId: body.context.correlationId,
          observedAt: new Date().toISOString(),
          monotonicOffsetMs: Math.max(0, Math.round((performance.now() - monotonicStart) * 100) / 100),
        },
        independentSource,
      ));
      json(response, 200, { output });
    } catch (error) {
      json(response, 422, { error: safeError(error) });
    }
  });

  server.listen(port, "0.0.0.0", () => process.stdout.write(`FastGate connector witness listening on ${port}\n`));
  process.once("SIGTERM", () => { void closeTranscript().finally(() => server.close()); });
  process.once("SIGINT", () => { void closeTranscript().finally(() => server.close()); });

  async function closeTranscript(): Promise<void> {
    if (closed) return;
    closed = true;
    const jsonl = events.map((event) => JSON.stringify(event)).join("\n");
    writeFileSync(join(artifactDir, "connector-transcript.jsonl"), `${jsonl}${jsonl ? "\n" : ""}`, { mode: 0o600 });
    writeFileSync(join(artifactDir, "connector-transcript.final.json"), `${JSON.stringify({
      schemaVersion: "mtr-fastgate-connector-transcript-final-v1",
      runId: context.runId,
      runNonce: context.runNonce,
      eventCount: events.length,
      certificate: signer.certificate,
      supervisorCertificate: context.supervisorCertificate,
      issuedCertificate,
      events,
    }, null, 2)}\n`, { mode: 0o600 });
    await closeDatabase();
  }
}

function proofFromIndependentSource(input: Readonly<{
  capabilityKey: UniversalReadCapabilityKey;
  subjectId: string;
  correlationId: string;
  httpTemplateId: string;
  httpRequestHash: string;
  input: unknown;
  output: unknown;
  ordinal: number;
  independentSource: Readonly<{
    sourceSnapshotId: string;
    sourceRowIds: readonly string[];
    sourceRowHashes: readonly string[];
    snapshotIds: readonly string[];
  }>;
}>): ConnectorProof {
  const resultHash = sha256Hex(canonicalJson(input.output));
  return Object.freeze({
    proofId: `proof-${sha256Hex(`${input.correlationId}:${input.ordinal}:${input.capabilityKey}`).slice(0, 32)}`,
    capability: input.capabilityKey,
    connector: connectorForCapability(input.capabilityKey),
    operation: input.capabilityKey,
    subjectHash: sha256Hex(input.subjectId),
    httpTemplateId: input.httpTemplateId,
    httpRequestHash: input.httpRequestHash,
    normalizedArguments: input.input,
    argumentHash: sha256Hex(canonicalJson(input.input)),
    sourceSnapshotId: input.independentSource.sourceSnapshotId,
    sourceRowIds: input.independentSource.sourceRowIds,
    sourceRowHashes: input.independentSource.sourceRowHashes,
    projectionHash: resultHash,
    resultHash,
    resultStatus: outputMissing(input.output) ? "NOT_FOUND" : "OK",
    snapshotIds: input.independentSource.snapshotIds,
  });
}

function connectorForCapability(key: UniversalReadCapabilityKey): ConnectorProof["connector"] {
  if (key.startsWith("project.") || key.startsWith("specification.")) return "APPIUS";
  if (key.startsWith("material.")) return "SAP";
  if (key.startsWith("catalog.")) return "CATALOG";
  if (key.startsWith("compatibility.") || key.startsWith("reliability.")) return "NORMATIVE";
  return "PROCESS";
}

function outputMissing(value: unknown): boolean {
  return value === null || value === undefined || Array.isArray(value) && value.length === 0;
}

async function waitForJson<T>(path: string): Promise<T> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as T;
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    }
  }
  throw new Error(`FASTGATE_INPUT_TIMEOUT:${path.split("/").at(-1)}`);
}

async function readJson<T>(request: IncomingMessage, limit: number): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > limit) throw new Error("FASTGATE_WITNESS_REQUEST_TOO_LARGE");
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function stringHeader(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function requiredHeader(request: IncomingMessage, name: string, pattern: RegExp): string {
  const value = stringHeader(request, name);
  if (!value || !pattern.test(value)) throw new Error("FASTGATE_WITNESS_HTTP_BINDING_INVALID");
  return value;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(`${JSON.stringify(value)}\n`);
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "FASTGATE_WITNESS_ERROR";
  return /^FASTGATE_|^UNIVERSAL_|^AGENT_/u.test(message)
    ? message.slice(0, 200)
    : "FASTGATE_WITNESS_EXECUTION_FAILED";
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function requiredDigest(name: string): string {
  const value = requiredEnv(name);
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) throw new Error(`${name}_INVALID`);
  return value;
}

function boundedPort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new Error("INVALID_FASTGATE_PORT");
  return port;
}

function assertWitnessEnvironment(): void {
  if (process.env.FASTGATE_OFFICIAL !== "1") throw new Error("FASTGATE_WITNESS_OFFICIAL_ONLY");
  if (process.env.DATABASE_URL?.trim()) throw new Error("FASTGATE_WITNESS_REMOTE_DATABASE_FORBIDDEN");
  const dataDir = requiredEnv("PGLITE_DATA_DIR");
  if (!dataDir.startsWith("/run/fastgate-witness-database/")) {
    throw new Error("FASTGATE_WITNESS_DATA_DIR_FORBIDDEN");
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`FASTGATE_WITNESS_FAILED:${error instanceof Error ? error.message : "UNKNOWN"}\n`);
  process.exitCode = 2;
});

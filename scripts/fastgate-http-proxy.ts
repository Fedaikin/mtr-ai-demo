import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  createEphemeralAttestationSigner,
  sha256Hex,
} from "@/evals/fastgate/official/attestation";
import { createSignedTranscriptRecorder } from "@/evals/fastgate/official/transcript";

interface RunContext {
  readonly schemaVersion: "mtr-fastgate-proxy-context-v1";
  readonly runId: string;
  readonly runNonce: string;
  readonly proxyControlToken: string;
  readonly applicationControlToken: string;
  readonly witnessGatewayToken: string;
  readonly startedAt: string;
}

async function main(): Promise<void> {
const upstream = new URL(requiredEnv("FASTGATE_UPSTREAM_URL"));
const applicationControlUrl = new URL(requiredEnv("FASTGATE_APPLICATION_CONTROL_URL"));
const witnessUpstream = new URL(requiredEnv("FASTGATE_WITNESS_UPSTREAM_URL"));
const port = boundedPort(process.env.FASTGATE_PROXY_PORT ?? "4310");
const artifactDir = resolve(requiredEnv("FASTGATE_ARTIFACT_DIR"));
const controlDir = resolve(requiredEnv("FASTGATE_CONTROL_DIR"));
const context = await waitForRunContext(join(controlDir, "proxy-context.json"));
const signer = createEphemeralAttestationSigner({
  role: "HTTP_PROXY",
  runId: context.runId,
  runNonce: context.runNonce,
  issuedAt: context.startedAt,
});
const recorder = createSignedTranscriptRecorder({ signer, transcriptKind: "HTTP" });
const monotonicStart = performance.now();
let ordinal = 0;
let closed = false;
const sessionSubjects = new Map<string, string>();
const activeAgentRequests = new Map<string, Readonly<{
  subjectHash: string;
  templateId: string;
  requestHash: string;
}>>();

mkdirSync(artifactDir, { recursive: true });
writeFileSync(join(artifactDir, "http-proxy-certificate.json"), `${JSON.stringify(signer.certificate, null, 2)}\n`, { mode: 0o600 });

const server = createServer(async (request, response) => {
  try {
    if (request.url === "/__fastgate/control/close") {
      await handleClose(request, response);
      return;
    }
    if (request.url === "/__fastgate/control/target-state") {
      await handleTargetState(request, response);
      return;
    }
    if (request.url === "/__fastgate/witness/v1/capability") {
      await handleWitnessGateway(request, response);
      return;
    }
    if (closed) {
      json(response, 503, { error: "FASTGATE_TRANSCRIPT_CLOSED" });
      return;
    }
    await forwardAndRecord(request, response);
  } catch (error) {
    json(response, 502, { error: safeError(error) });
  }
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`FastGate signed proxy listening on ${port}\n`);
});

process.once("SIGTERM", () => void closeTranscript().finally(() => server.close()));
process.once("SIGINT", () => void closeTranscript().finally(() => server.close()));

async function forwardAndRecord(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const startedOffsetMs = roundMs(performance.now() - monotonicStart);
  const body = await readBoundedBody(request, 2 * 1024 * 1024);
  const route = normalizeRoute(request.url ?? "/");
  const isAgentMessage = request.method === "POST" && route === "/api/agent/threads/:threadId/messages";
  const templateId = stringHeader(request, "x-fastgate-template-id");
  if (isAgentMessage && !templateId) {
    json(response, 400, { error: "FASTGATE_TEMPLATE_ID_REQUIRED" });
    return;
  }
  const target = new URL(request.url ?? "/", upstream);
  const correlationId = stringHeader(request, "x-request-id") ?? `proxy-pending-${ordinal + 1}`;
  const subjectHash = subjectHashFromSession(request.headers.cookie ?? null);
  const requestHash = sha256Hex(body);
  if (isAgentMessage) {
    if (!templateId || !subjectHash || !stringHeader(request, "x-request-id")) {
      json(response, 401, { error: "FASTGATE_MESSAGE_IDENTITY_BINDING_REQUIRED" });
      return;
    }
    if (activeAgentRequests.has(correlationId)) {
      json(response, 409, { error: "FASTGATE_MESSAGE_CORRELATION_REUSED" });
      return;
    }
    activeAgentRequests.set(correlationId, { subjectHash, templateId, requestHash });
  }
  const forwardedHeaders = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || name.toLowerCase() === "host") continue;
    forwardedHeaders.set(name, Array.isArray(value) ? value.join(",") : value);
  }
  forwardedHeaders.set("x-forwarded-host", request.headers.host ?? "http-proxy:4310");
  forwardedHeaders.set("x-forwarded-proto", "http");
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(target, {
      method: request.method,
      headers: forwardedHeaders,
      ...(request.method === "GET" || request.method === "HEAD" || body.length === 0
        ? {}
        : { body: Uint8Array.from(body) as unknown as BodyInit }),
      redirect: "manual",
    });
  } finally {
    if (isAgentMessage) activeAgentRequests.delete(correlationId);
  }
  const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
  captureAuthenticatedSession(route, request.method, upstreamResponse, responseBody);
  response.statusCode = upstreamResponse.status;
  const decodedResponseHeaders = new Set([
    "connection",
    "content-encoding",
    "content-length",
    "keep-alive",
    "transfer-encoding",
  ]);
  upstreamResponse.headers.forEach((value, name) => {
    if (!decodedResponseHeaders.has(name.toLowerCase())) response.setHeader(name, value);
  });
  response.setHeader("content-length", String(responseBody.byteLength));
  response.end(responseBody);

  ordinal += 1;
  const recordedCorrelationId = upstreamResponse.headers.get("x-request-id") ?? correlationId;
  const responseIds = extractResponseIds(responseBody);
  recorder.append({
    ordinal,
    startedOffsetMs,
    finishedOffsetMs: roundMs(performance.now() - monotonicStart),
    method: normalizeMethod(request.method),
    normalizedRoute: route,
    correlationId: recordedCorrelationId,
    subjectHash,
    permissionSetHash: safeIdentityHash(stringHeader(request, "x-fastgate-permission-set-hash")),
    threadIdHash: hashRouteEntity(request.url ?? "/", /^\/api\/agent\/threads\/([^/]+)/u),
    messageIdHash: responseIds.messageId ? sha256Hex(responseIds.messageId) : null,
    requestHash,
    responseHash: sha256Hex(responseBody),
    status: upstreamResponse.status,
    templateId,
    isAgentMessage,
    retryOfOrdinal: parseRetryOrdinal(stringHeader(request, "x-fastgate-retry-of"), ordinal),
  });
}

async function handleWitnessGateway(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "POST" || closed) {
    json(response, 403, { error: "FASTGATE_WITNESS_GATEWAY_DENIED" });
    return;
  }
  const body = await readBoundedBody(request, 1_000_000);
  const parsed = JSON.parse(body.toString("utf8")) as { context?: { correlationId?: unknown; subjectId?: unknown } };
  const correlationId = parsed.context?.correlationId;
  const subjectId = parsed.context?.subjectId;
  if (typeof correlationId !== "string" || typeof subjectId !== "string") {
    json(response, 403, { error: "FASTGATE_WITNESS_GATEWAY_CONTEXT_INVALID" });
    return;
  }
  const active = activeAgentRequests.get(correlationId);
  if (!active || sha256Hex(subjectId) !== active.subjectHash) {
    json(response, 403, { error: "FASTGATE_WITNESS_GATEWAY_SUBJECT_MISMATCH" });
    return;
  }
  const upstreamResponse = await fetch(new URL("/v1/capability", witnessUpstream), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": correlationId,
      "x-fastgate-witness-gateway-token": context.witnessGatewayToken,
      "x-fastgate-http-template-id": active.templateId,
      "x-fastgate-http-request-hash": active.requestHash,
      "x-fastgate-http-subject-hash": active.subjectHash,
    },
    body: Uint8Array.from(body) as unknown as BodyInit,
  });
  const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
  response.statusCode = upstreamResponse.status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", String(responseBody.byteLength));
  response.end(responseBody);
}

function captureAuthenticatedSession(
  route: string,
  method: string | undefined,
  response: Response,
  body: Buffer,
): void {
  if (route !== "/api/auth/login" || method !== "POST" || response.status !== 200) return;
  try {
    const value = JSON.parse(body.toString("utf8")) as { user?: { id?: unknown } };
    const userId = value.user?.id;
    const cookie = response.headers.get("set-cookie");
    const token = cookieValue(cookie, "mtr_session");
    if (typeof userId === "string" && token) sessionSubjects.set(token, sha256Hex(userId));
  } catch {
    // A malformed login response remains unbound and cannot invoke witness capabilities.
  }
}

function subjectHashFromSession(cookieHeader: string | null): string | null {
  const token = cookieValue(cookieHeader, "mtr_session");
  return token ? sessionSubjects.get(token) ?? null : null;
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 1 || item.slice(0, separator).trim() !== name) continue;
    const value = item.slice(separator + 1).trim();
    return value || null;
  }
  return null;
}

async function handleClose(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "POST" || stringHeader(request, "x-fastgate-control-token") !== context.proxyControlToken) {
    json(response, 403, { error: "FASTGATE_CONTROL_DENIED" });
    return;
  }
  const transcript = await closeTranscript();
  json(response, 200, { closed: true, entryCount: transcript.entries.length });
}

async function handleTargetState(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const token = stringHeader(request, "x-fastgate-control-token");
  if (request.method !== "POST" || token !== context.proxyControlToken || closed) {
    json(response, 403, { error: "FASTGATE_CONTROL_DENIED" });
    return;
  }
  const upstreamResponse = await fetch(new URL("/__fastgate/control/target-state", applicationControlUrl), {
    method: "POST",
    headers: { "x-fastgate-control-token": context.applicationControlToken },
  });
  const body = Buffer.from(await upstreamResponse.arrayBuffer());
  response.statusCode = upstreamResponse.status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", String(body.byteLength));
  response.end(body);
}

async function closeTranscript() {
  if (closed) return JSON.parse(readFileSync(join(artifactDir, "http-transcript.final.json"), "utf8")) as ReturnType<typeof recorder.close>;
  closed = true;
  const transcript = recorder.close();
  const jsonl = transcript.entries.map((entry) => JSON.stringify(entry)).join("\n");
  writeFileSync(join(artifactDir, "http-transcript.jsonl"), `${jsonl}${jsonl ? "\n" : ""}`, { mode: 0o600 });
  writeFileSync(join(artifactDir, "http-transcript.final.json"), `${JSON.stringify(transcript, null, 2)}\n`, { mode: 0o600 });
  return transcript;
}
}

void main().catch((error: unknown) => {
  process.stderr.write(`FASTGATE_PROXY_FAILED:${error instanceof Error ? error.message : "UNKNOWN"}\n`);
  process.exitCode = 2;
});

function normalizeRoute(input: string): string {
  const path = new URL(input, "http://fastgate.invalid").pathname;
  return path
    .replace(/(\/api\/agent\/threads\/)[^/]+/u, "$1:threadId")
    .replace(/(\/api\/agent\/actions\/)[^/]+/u, "$1:actionId")
    .replace(/(\/api\/reports\/)[^/]+/u, "$1:runId");
}

function normalizeMethod(method: string | undefined): "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" {
  const upper = (method ?? "GET").toUpperCase();
  if (["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(upper)) return upper as ReturnType<typeof normalizeMethod>;
  throw new Error("UNSUPPORTED_HTTP_METHOD");
}

function extractResponseIds(body: Buffer): { messageId: string | null } {
  try {
    const value = JSON.parse(body.toString("utf8")) as { items?: Array<{ id?: unknown; role?: unknown }> };
    const messageId = value.items?.find((item) => item.role === "assistant")?.id;
    return { messageId: typeof messageId === "string" ? messageId : null };
  } catch {
    return { messageId: null };
  }
}

function safeIdentityHash(value: string | null): string | null {
  if (!value) return null;
  return /^[a-f0-9]{64}$/u.test(value) ? value : sha256Hex(value);
}

function hashRouteEntity(path: string, pattern: RegExp): string | null {
  const value = new URL(path, "http://fastgate.invalid").pathname.match(pattern)?.[1];
  return value ? sha256Hex(decodeURIComponent(value)) : null;
}

function parseRetryOrdinal(value: string | null, currentOrdinal: number): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed < currentOrdinal ? parsed : null;
}

async function readBoundedBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > limit) throw new Error("FASTGATE_REQUEST_TOO_LARGE");
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function waitForRunContext(path: string): Promise<RunContext> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const value = JSON.parse(readFileSync(path, "utf8")) as RunContext;
      if (value.schemaVersion === "mtr-fastgate-proxy-context-v1") return value;
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    }
  }
  throw new Error("FASTGATE_RUN_CONTEXT_TIMEOUT");
}

function stringHeader(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(value)}\n`);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function boundedPort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new Error("INVALID_FASTGATE_PORT");
  return port;
}

function roundMs(value: number): number {
  return Math.max(0, Math.round(value * 100) / 100);
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : "FASTGATE_PROXY_ERROR";
}

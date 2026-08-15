import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import { initializeDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { applyDatabaseCounterfactualOverlay } from "@/evals/fastgate/official/database-overlay";
import { prepareLocalFastGateFixture } from "@/evals/fastgate/local-fixture";
import { buildLocalFastGateOracle } from "@/evals/fastgate/reference-oracle";

const fixtureSchema = z.object({
  schemaVersion: z.literal("mtr-fastgate-application-fixture-v1"),
  overlaySeed: z.string().regex(/^[a-f0-9]{64}$/u),
  scenarioInstant: z.string().datetime(),
  datasetVersion: z.string().min(1),
  publicFixture: z.record(z.string(), z.unknown()),
}).strict();

async function main(): Promise<void> {
  assertApplicationEnvironment();
  removeLoadedBootstrapEntrypoint();
  const fixturePath = resolve(requiredEnv("FASTGATE_PUBLIC_FIXTURE_PATH"));
  const fixture = fixtureSchema.parse(await waitForJson(fixturePath));
  await initializeDatabase();
  const database = await getDatabase({ migrations: "skip" });
  const overlay = await applyDatabaseCounterfactualOverlay(database, {
    seed: fixture.overlaySeed,
    scenarioInstant: fixture.scenarioInstant,
  });
  const completedRunId = await prepareLocalFastGateFixture(requiredEnv("FASTGATE_FIXTURE_RUN_ID"));
  const baseline = await buildLocalFastGateOracle(requiredEnv("FASTGATE_DEPLOYMENT_SHA"));
  const evidencePath = resolve(requiredEnv("FASTGATE_APPLICATION_BOOTSTRAP_EVIDENCE"));
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify({
    schemaVersion: "mtr-fastgate-application-bootstrap-v1",
    completedRunId,
    overlay,
    baselineTargetStateChecksum: baseline.targetStateChecksum,
    baselineDatabaseStateChecksum: baseline.databaseState.checksumSha256,
  }, null, 2)}\n`, { mode: 0o600 });
  await closeDatabase();

  const child = spawn(process.execPath, ["/app/server.js"], {
    cwd: "/app",
    env: sanitizedApplicationEnvironment(process.env),
    uid: 1000,
    gid: 1000,
    stdio: "inherit",
  });
  let targetStateRequested = false;
  const childExit = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>((resolveExit) => {
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  const controlToken = requiredEnv("FASTGATE_APPLICATION_CONTROL_TOKEN");
  const postRunStatePath = resolve(requiredEnv("FASTGATE_POST_RUN_STATE_PATH"));
  if (postRunStatePath !== "/run/fastgate-database/post-run-state.json") {
    throw new Error("FASTGATE_POST_RUN_STATE_PATH_FORBIDDEN");
  }
  const controlServer = createServer(async (request, response) => {
    try {
      if (request.url !== "/__fastgate/control/target-state" || request.method !== "POST") {
        json(response, 404, { error: "FASTGATE_APPLICATION_CONTROL_NOT_FOUND" });
        return;
      }
      if (stringHeader(request, "x-fastgate-control-token") !== controlToken || targetStateRequested) {
        json(response, 403, { error: "FASTGATE_APPLICATION_CONTROL_DENIED" });
        return;
      }
      targetStateRequested = true;
      child.kill("SIGTERM");
      const exited = await Promise.race([
        childExit.then(() => true),
        new Promise<false>((resolveTimeout) => setTimeout(() => resolveTimeout(false), 30_000)),
      ]);
      if (!exited) throw new Error("FASTGATE_APPLICATION_SHUTDOWN_TIMEOUT");
      await closeDatabase();
      const after = await buildLocalFastGateOracle(requiredEnv("FASTGATE_DEPLOYMENT_SHA"));
      await closeDatabase();
      const postRunState = {
        schemaVersion: "mtr-fastgate-post-run-state-v1",
        baselineTargetStateChecksum: baseline.targetStateChecksum,
        targetStateChecksum: after.targetStateChecksum,
        dataChecksum: after.dataChecksum,
        databaseStateBefore: baseline.databaseState,
        databaseStateAfter: after.databaseState,
        actionSafetyBefore: baseline.actionSafetyState,
        actionSafetyAfter: after.actionSafetyState,
        reviewSafetyBefore: baseline.reviewSafetyState,
        reviewSafetyAfter: after.reviewSafetyState,
      } as const;
      const serializedPostRunState = `${JSON.stringify(postRunState)}\n`;
      const temporaryPostRunStatePath = `${postRunStatePath}.tmp-${process.pid}`;
      writeFileSync(temporaryPostRunStatePath, serializedPostRunState, { mode: 0o600 });
      renameSync(temporaryPostRunStatePath, postRunStatePath);
      json(response, 200, {
        schemaVersion: "mtr-fastgate-post-run-state-reference-v1",
        postRunStateSha256: createHash("sha256").update(serializedPostRunState).digest("hex"),
        byteLength: Buffer.byteLength(serializedPostRunState),
      });
      controlServer.close();
    } catch (error) {
      json(response, 500, { error: error instanceof Error ? error.message : "FASTGATE_APPLICATION_CONTROL_FAILED" });
    }
  });
  controlServer.listen(boundedPort(process.env.FASTGATE_APPLICATION_CONTROL_PORT ?? "4330"), "0.0.0.0");
  const forward = (signal: NodeJS.Signals) => {
    if (!child.killed) child.kill(signal);
    controlServer.close();
  };
  process.once("SIGTERM", () => forward("SIGTERM"));
  process.once("SIGINT", () => forward("SIGINT"));
  childExit.then(({ code }) => {
    if (!targetStateRequested) {
      process.exitCode = code ?? 2;
      controlServer.close();
    }
  });
}

function removeLoadedBootstrapEntrypoint(): void {
  const entrypoint = resolve(process.argv[1] ?? "");
  if (entrypoint !== "/opt/fastgate-control/application-start.mjs") {
    throw new Error("FASTGATE_APPLICATION_BOOTSTRAP_ENTRYPOINT_FORBIDDEN");
  }
  unlinkSync(entrypoint);
}

function sanitizedApplicationEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const allowed = [
    "APP_MODE",
    "DEMO_PASSWORD_HASH",
    "DEMO_ROLE_SELECTOR",
    "FASTGATE_DEPLOYMENT_SHA",
    "FASTGATE_OFFICIAL",
    "FASTGATE_WITNESS_URL",
    "HOSTNAME",
    "MTR_AGENT_ACTION_MODE",
    "MTR_AGENT_ACTIONS_ENABLED",
    "MTR_AGENT_LIVE_LLM_ENABLED",
    "MTR_AGENT_ORCHESTRATOR_ENABLED",
    "MTR_AGENT_UNIVERSAL_CHAT_ENABLED",
    "NEXT_TELEMETRY_DISABLED",
    "NODE_ENV",
    "PATH",
    "PGLITE_DATA_DIR",
    "PORT",
    "TZ",
  ] as const;
  const sanitized = Object.fromEntries(allowed.flatMap((name) => {
    const value = environment[name];
    return value === undefined ? [] : [[name, value]];
  }));
  return { ...sanitized, NODE_ENV: environment.NODE_ENV ?? "production" } as NodeJS.ProcessEnv;
}

async function waitForJson(path: string): Promise<unknown> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    }
  }
  throw new Error("FASTGATE_APPLICATION_FIXTURE_TIMEOUT");
}

function assertApplicationEnvironment(): void {
  if (process.env.FASTGATE_OFFICIAL !== "1") throw new Error("FASTGATE_APPLICATION_OFFICIAL_ONLY");
  if (process.env.DATABASE_URL?.trim()) throw new Error("FASTGATE_APPLICATION_REMOTE_DATABASE_FORBIDDEN");
  const dataDir = requiredEnv("PGLITE_DATA_DIR");
  if (!dataDir.startsWith("/run/fastgate-database/")) throw new Error("FASTGATE_APPLICATION_DATA_DIR_FORBIDDEN");
  if (process.env.FASTGATE_SOURCE_BINDING_PRIVATE_KEY?.trim()) {
    throw new Error("FASTGATE_APPLICATION_WITNESS_KEY_FORBIDDEN");
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function stringHeader(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function boundedPort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new Error("FASTGATE_APPLICATION_CONTROL_PORT_INVALID");
  return port;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

void main().catch((error: unknown) => {
  process.stderr.write(`FASTGATE_APPLICATION_FAILED:${error instanceof Error ? error.message : "UNKNOWN"}\n`);
  process.exitCode = 2;
});

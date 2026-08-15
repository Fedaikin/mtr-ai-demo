import { execFileSync, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from "node:fs";
import { homedir, totalmem } from "node:os";
import { join, resolve } from "node:path";

import {
  inspectFastGateRuntime,
  isAcceptedDockerIsolation,
  type FastGateContainerRuntime,
} from "@/evals/fastgate/official/runtime";

const BASE_IMAGE = "node:24.6.0-bookworm-slim@sha256:798837daa2a12bab9cdf53cf8779a05256c2ce08176f449e239e7577d26225e8";
const BASE_IMAGE_INDEX_DIGEST = "9b741b28148b0195d62fa456ed84dd6c953c1f17a3761f3e6e6797a754d9edff";
const FIVE_BLOCKERS = [
  "INDEPENDENT_CONNECTOR_WITNESS_UNAVAILABLE",
  "SIGNED_HTTP_TRANSCRIPT_UNAVAILABLE",
  "DETACHED_READ_ONLY_BUILD_ATTESTATION_UNAVAILABLE",
  "DISPOSABLE_VM_OR_CONTAINER_UNAVAILABLE",
  "COUNTERFACTUAL_OVERLAY_WITNESS_UNAVAILABLE",
] as const;

export interface FastGateDoctorReport {
  readonly schemaVersion: "mtr-agent-fastgate-doctor-v1";
  readonly createdAt: string;
  readonly ready: boolean;
  readonly git: Readonly<{ sha: string; tree: string; clean: boolean }>;
  readonly host: Readonly<{ platform: string; kernel: string; arch: string; ramBytes: number; freeDiskBytes: number }>;
  readonly runtime: Readonly<{
    selected: FastGateContainerRuntime | null;
    version: string | null;
    available: readonly FastGateContainerRuntime[];
    probeCreatedAndDestroyed: boolean;
    rootlessOrDesktop: boolean;
  }>;
  readonly baseImages: readonly Readonly<{ reference: string; digest: string; indexDigest: string; platform: string }>[];
  readonly definitions: Readonly<{ containerDefinitionsSha256: string; networkPolicySha256: string }>;
  readonly checks: Readonly<{
    lockfile: boolean;
    ephemeralEd25519: boolean;
    composeDefinition: boolean;
    internalNetworkPolicy: boolean;
    loopbackOnly: boolean;
    noProductionSecretsRequired: boolean;
  }>;
  readonly blockerStatus: Readonly<Record<typeof FIVE_BLOCKERS[number], "RESOLVED" | "STATIC_READY_RUNTIME_REQUIRED" | "UNRESOLVED">>;
  readonly blockers: readonly string[];
}

export async function buildFastGateDoctorReport(input: Readonly<{
  cwd?: string;
  probeContainer?: boolean;
  now?: string;
}> = {}): Promise<FastGateDoctorReport> {
  const cwd = resolve(input.cwd ?? process.cwd());
  const runtimeInspection = await inspectFastGateRuntime();
  const runtime = runtimeInspection.selectedRuntime;
  const composePath = join(cwd, "infra/fastgate/compose.yml");
  const compose = existsSync(composePath) ? readFileSync(composePath, "utf8") : "";
  const gitSha = safeGit(cwd, ["rev-parse", "HEAD"]);
  const tree = safeGit(cwd, ["rev-parse", "HEAD^{tree}"]);
  const clean = safeGit(cwd, ["status", "--porcelain"]) === "";
  const ephemeralEd25519 = canGenerateEphemeralEd25519();
  const runtimeVersion = runtime ? readRuntimeVersion(runtime, cwd) : null;
  const probeCreatedAndDestroyed = runtime && input.probeContainer === true
    ? probeDisposableContainer(runtime, cwd)
    : false;
  const rootlessOrDesktop = runtime ? inspectRootlessOrDesktop(runtime, cwd) : false;
  const staticReady = compose.length > 0
    && compose.includes("internal: true")
    && compose.includes("read_only: true")
    && compose.includes("no-new-privileges:true");
  const runtimeReady = Boolean(runtime && runtimeVersion && probeCreatedAndDestroyed && rootlessOrDesktop);
  const blockerStatus = Object.fromEntries(FIVE_BLOCKERS.map((blocker) => {
    if (blocker === "DISPOSABLE_VM_OR_CONTAINER_UNAVAILABLE") return [blocker, runtimeReady ? "RESOLVED" : "UNRESOLVED"];
    return [blocker, runtimeReady && staticReady ? "RESOLVED" : staticReady ? "STATIC_READY_RUNTIME_REQUIRED" : "UNRESOLVED"];
  })) as FastGateDoctorReport["blockerStatus"];
  const blockers = Object.entries(blockerStatus).filter(([, status]) => status !== "RESOLVED").map(([blocker]) => blocker);
  const disk = statfsSync(cwd);
  const report: FastGateDoctorReport = {
    schemaVersion: "mtr-agent-fastgate-doctor-v1",
    createdAt: input.now ?? new Date().toISOString(),
    ready: clean && Boolean(gitSha) && Boolean(tree) && existsSync(join(cwd, "pnpm-lock.yaml")) && ephemeralEd25519 && blockers.length === 0,
    git: { sha: gitSha, tree, clean },
    host: {
      platform: process.platform,
      kernel: safeKernel(),
      arch: process.arch,
      ramBytes: totalmem(),
      freeDiskBytes: disk.bavail * disk.bsize,
    },
    runtime: {
      selected: runtime,
      version: runtimeVersion,
      available: runtimeInspection.availableRuntimes,
      probeCreatedAndDestroyed,
      rootlessOrDesktop,
    },
    baseImages: [{
      reference: BASE_IMAGE,
      digest: BASE_IMAGE.split("@sha256:")[1]!,
      indexDigest: BASE_IMAGE_INDEX_DIGEST,
      platform: `linux/${process.arch}`,
    }],
    definitions: {
      containerDefinitionsSha256: hashFiles(cwd, [
        "infra/fastgate/compose.yml",
        "infra/fastgate/Dockerfile.application",
        "infra/fastgate/Dockerfile.proxy",
        "infra/fastgate/Dockerfile.witness",
        "infra/fastgate/Dockerfile.supervisor",
        "infra/fastgate/Dockerfile.verifier",
      ]),
      networkPolicySha256: fileHash(join(cwd, "infra/fastgate/network-policy.json")),
    },
    checks: {
      lockfile: existsSync(join(cwd, "pnpm-lock.yaml")),
      ephemeralEd25519,
      composeDefinition: compose.length > 0,
      internalNetworkPolicy: compose.includes("internal: true"),
      loopbackOnly: !/ports:\s*\n\s*-\s*["']?0\.0\.0\.0/gu.test(compose),
      noProductionSecretsRequired: !/(VERCEL_TOKEN|PRODUCTION_DATABASE_URL|OPENAI_API_KEY)/u.test(compose),
    },
    blockerStatus,
    blockers,
  };
  return Object.freeze(report);
}

export function writeDoctorReport(report: FastGateDoctorReport, path: string): void {
  const target = resolve(path);
  mkdirSync(resolve(target, ".."), { recursive: true });
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

export function fastGateBaseImageReference(): string {
  return BASE_IMAGE;
}

function safeGit(cwd: string, args: readonly string[]): string {
  try {
    return execFileSync("git", [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function hashFiles(cwd: string, paths: readonly string[]): string {
  const hash = createHash("sha256");
  for (const path of [...paths].sort()) {
    hash.update(path);
    hash.update("\0");
    hash.update(readFileSync(join(cwd, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function safeKernel(): string {
  try {
    return execFileSync("uname", ["-sr"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function canGenerateEphemeralEd25519(): boolean {
  try {
    const keys = generateKeyPairSync("ed25519");
    return createHash("sha256").update(keys.publicKey.export({ format: "der", type: "spki" })).digest("hex").length === 64;
  } catch {
    return false;
  }
}

function readRuntimeVersion(runtime: FastGateContainerRuntime, cwd: string): string | null {
  const command = runtime === "colima" ? "colima" : runtime;
  const result = spawnSync(command, ["version"], { cwd, encoding: "utf8", timeout: 10_000 });
  return result.status === 0 ? `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().slice(0, 500) : null;
}

function inspectRootlessOrDesktop(runtime: FastGateContainerRuntime, cwd: string): boolean {
  if (runtime === "colima") {
    const result = spawnSync("colima", ["status"], { cwd, encoding: "utf8", timeout: 10_000 });
    return result.status === 0;
  }
  const command = runtime;
  const args = runtime === "docker" ? ["info", "--format", "{{json .SecurityOptions}}"] : ["info", "--format", "json"];
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 10_000 });
  if (result.status !== 0) return false;
  const output = `${result.stdout ?? ""}`.toLowerCase();
  if (runtime === "podman") return true;
  const context = spawnSync("docker", ["context", "show"], { cwd, encoding: "utf8", timeout: 10_000 });
  const endpoint = spawnSync(
    "docker",
    ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
    { cwd, encoding: "utf8", timeout: 10_000 },
  );
  const colima = spawnSync("colima", ["status"], { cwd, encoding: "utf8", timeout: 10_000 });
  return isAcceptedDockerIsolation({
    context: context.status === 0 ? `${context.stdout ?? ""}`.trim() : "",
    endpoint: endpoint.status === 0 ? `${endpoint.stdout ?? ""}`.trim() : "",
    homeDirectory: homedir(),
    colimaStatusOk: colima.status === 0,
    securityOptions: output,
  });
}

function probeDisposableContainer(runtime: FastGateContainerRuntime, cwd: string): boolean {
  const command = runtime === "podman" ? "podman" : "docker";
  const label = `mtr.fastgate.probe=${process.pid}`;
  const result = spawnSync(command, [
    "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--label", label,
    BASE_IMAGE, "node", "-e", "process.stdout.write('ok')",
  ], { cwd, encoding: "utf8", timeout: 120_000 });
  return result.status === 0 && result.stdout === "ok";
}

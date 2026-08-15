import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import manifestJson from "../evals/mtr-agent-fastgate-v1.json";
import { parseFastGateManifest } from "@/evals/fastgate/scoring";
import {
  assessStrictWitnessEnvironment,
  createSignedRunIdentity,
  FASTGATE_REQUIRED_OFFICIAL_RUNS,
  hasExactOfficialRunSet,
  runIdentitySha256,
  sha256,
  uniqueCryptographicSeeds,
  writeImmutableRunIdentity,
} from "@/evals/fastgate/supervisor";

const manifest = parseFastGateManifest(manifestJson);

interface ChildResult {
  readonly seed: string;
  readonly artifactDir: string;
  readonly result: Readonly<{
    rawScore: number;
    cappedScore: number;
    assessmentConfidence: string;
    warmP95Ms: number;
    durationMs: number;
    actualAgentMessages: number;
    verdict: string;
    exitCode: number;
    caseResults: readonly Readonly<{ id: string; status: string; sourceBindingVerified: boolean }>[];
    deploymentIdentity: Readonly<{ sha: string }>;
    runIdentity?: Readonly<{ runIdentitySha256: string; selectionCommitmentSha256: string }>;
  }>;
}

function main(): void {
  const runs = parseRuns(process.argv.slice(2));
  const cwd = process.cwd();
  const sha = git("rev-parse", "HEAD");
  assertCleanTrackedTree();
  const sourceTreeSha256 = trackedTreeHash();
  const lockfileSha256 = fileHash(resolve("pnpm-lock.yaml"));
  const manifestSha256 = fileHash(resolve("evals/mtr-agent-fastgate-v1.json"));
  const evaluatorSha256 = fileHash(resolve("scripts/eval-agent-fastgate.ts"));
  const oracleSha256 = fileHash(resolve("src/evals/fastgate/reference-oracle.ts"));
  const sandboxProfile = makeSandboxProfile(cwd);
  const sandboxProfileSha256 = sha256(sandboxProfile);
  const strictWitness = assessStrictWitnessEnvironment();
  if (!strictWitness.ready) {
    writeBlockedEnvironmentAggregate({
      sha,
      sourceTreeSha256,
      lockfileSha256,
      manifestSha256,
      evaluatorSha256,
      oracleSha256,
      sandboxProfileSha256,
    }, strictWitness.blockers, runs);
    return;
  }
  const supervisorDir = mkdtempSync(join(tmpdir(), "mtr-fastgate-supervisor-"));
  const seeds = uniqueCryptographicSeeds(runs);
  const children: ChildResult[] = [];
  try {
    for (const [index, seed] of seeds.entries()) {
      const identity = createSignedRunIdentity({
        manifest,
        seed,
        deploymentSha: sha,
        sourceTreeSha256,
        lockfileSha256,
        manifestSha256,
        evaluatorSha256,
        oracleSha256,
        sandboxProfileSha256,
      });
      const identityPath = join(supervisorDir, `run-${index + 1}-identity.json`);
      writeImmutableRunIdentity(identityPath, identity);
      const output = runChild({
        seed,
        identityPath,
        runIdentitySha256: runIdentitySha256(identity),
        port: 3187 + index,
        sandboxProfile,
      });
      process.stdout.write(output.stdout);
      if (output.stderr) process.stderr.write(output.stderr);
      const artifactDir = output.stdout.match(/Artifacts:\s*(.+)\s*$/mu)?.[1]?.trim();
      if (!artifactDir) throw new Error(`FASTGATE_CHILD_ARTIFACT_MISSING:${index + 1}`);
      const result = JSON.parse(readFileSync(join(artifactDir, "result.json"), "utf8")) as ChildResult["result"];
      children.push({ seed, artifactDir, result });
      if (output.status !== 0 || result.exitCode !== 0) throw new Error(`FASTGATE_CHILD_FAILED:${index + 1}:${output.status ?? "signal"}`);
      assertChild(identity, result);
      assertCleanTrackedTree();
      if (trackedTreeHash() !== sourceTreeSha256) throw new Error("SOURCE_TREE_CHANGED_DURING_RUN");
    }
    writeAggregate(children, {
      sha,
      sourceTreeSha256,
      lockfileSha256,
      manifestSha256,
      evaluatorSha256,
      oracleSha256,
      sandboxProfileSha256,
    });
  } finally {
    chmodTreeWritable(supervisorDir);
    rmSync(supervisorDir, { recursive: true, force: true });
  }
}

function runChild(input: Readonly<{
  seed: string;
  identityPath: string;
  runIdentitySha256: string;
  port: number;
  sandboxProfile: string;
}>): Readonly<{ status: number | null; stdout: string; stderr: string }> {
  const env = sanitizedEnvironment({
    NODE_ENV: "development",
    FASTGATE_SUPERVISED: "true",
    FASTGATE_RUN_IDENTITY_FILE: input.identityPath,
    FASTGATE_RUN_IDENTITY_SHA256: input.runIdentitySha256,
    FASTGATE_SANDBOX_LEVEL: "MACOS_DENY_EXTERNAL_EGRESS_AND_SENSITIVE_HOME",
    PORT: String(input.port),
  });
  const args = [
    "-p", input.sandboxProfile,
    process.execPath,
    "--conditions=react-server",
    "--import", "tsx",
    "scripts/eval-agent-fastgate.ts",
    "--seed", input.seed,
  ];
  const child = spawnSync("/usr/bin/sandbox-exec", args, {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: 900_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  return { status: child.status, stdout: child.stdout ?? "", stderr: child.stderr ?? "" };
}

function assertChild(identity: ReturnType<typeof createSignedRunIdentity>, result: ChildResult["result"]): void {
  if (result.deploymentIdentity.sha !== identity.deploymentSha) throw new Error("DEPLOYMENT_SHA_MISMATCH");
  if (result.actualAgentMessages !== 23) throw new Error("MESSAGE_BUDGET_MISMATCH");
  if (result.cappedScore < 93 || result.assessmentConfidence !== "HIGH") throw new Error("RELEASE_SCORE_NOT_MET");
  if (result.caseResults.some((item) => item.status !== "PASS")) throw new Error("MANDATORY_CASE_NOT_PASS");
  const factual = new Set(["FG-02", "FG-03", "FG-04", "FG-05", "FG-06", "FG-07", "FG-09", "FG-11"]);
  if (result.caseResults.some((item) => factual.has(item.id) && !item.sourceBindingVerified)) throw new Error("SOURCE_BINDING_NOT_PROVEN");
  if (result.runIdentity?.runIdentitySha256 !== runIdentitySha256(identity)) throw new Error("RUN_IDENTITY_MISMATCH");
  if (result.runIdentity?.selectionCommitmentSha256 !== identity.selectionCommitmentSha256) throw new Error("SELECTION_COMMITMENT_MISMATCH");
}

function writeAggregate(children: readonly ChildResult[], identity: Readonly<Record<string, string>>): void {
  const scores = children.map((item) => item.result.cappedScore).sort((a, b) => a - b);
  const p95s = children.map((item) => item.result.warmP95Ms).sort((a, b) => a - b);
  const durations = children.map((item) => item.result.durationMs).sort((a, b) => a - b);
  const uniqueSeedCount = new Set(children.map((item) => item.seed)).size;
  const pass = hasExactOfficialRunSet(children.length, uniqueSeedCount)
    && children.every((item) => item.result.exitCode === 0 && item.result.verdict === "READY FOR FULL ACCEPTANCE")
    && scores[0]! >= 93 && scores[Math.floor(scores.length / 2)]! >= 95;
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const artifactDir = resolve("test-results/mtr-agent-fastgate", `aggregate-${stamp}-${identity.sha!.slice(0, 12)}`);
  mkdirSync(artifactDir, { recursive: true });
  const aggregate = {
    schemaVersion: "mtr-agent-fastgate-aggregate-v1.1",
    createdAt: new Date().toISOString(),
    exactRuntime: identity,
    uniqueSeeds: uniqueSeedCount === children.length,
    runCount: children.length,
    releaseGate: pass ? "PASS" : "FAIL",
    score: { min: scores[0], median: scores[Math.floor(scores.length / 2)], max: scores.at(-1) },
    warmP95Ms: { min: p95s[0], median: p95s[Math.floor(p95s.length / 2)], max: p95s.at(-1) },
    durationMs: { min: durations[0], median: durations[Math.floor(durations.length / 2)], max: durations.at(-1) },
    runs: children.map((item) => ({ seed: item.seed, artifactDir: item.artifactDir, score: item.result.cappedScore, verdict: item.result.verdict })),
    previewAcceptanceStatus: "BLOCKED_BY_ENVIRONMENT",
    previewBlocker: "Exact-SHA non-Production Preview attestation and safe credentials were not supplied.",
  };
  writeFileSync(join(artifactDir, "aggregate.json"), `${JSON.stringify(aggregate, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(artifactDir, "report.md"), [
    "# MTR Agent FastGate v1.1 aggregate", "",
    `- Runs: ${children.length}`,
    `- Score min/median/max: ${scores[0]}/${scores[Math.floor(scores.length / 2)]}/${scores.at(-1)}`,
    `- Warm p95 min/median/max: ${p95s[0]}/${p95s[Math.floor(p95s.length / 2)]}/${p95s.at(-1)} ms`,
    `- LOCAL release gate: ${aggregate.releaseGate}`,
    "- Preview acceptance: BLOCKED_BY_ENVIRONMENT",
    "",
  ].join("\n"), { mode: 0o600 });
  process.stdout.write(`FASTGATE AGGREGATE: ${aggregate.releaseGate}\nAggregate artifacts: ${artifactDir}\n`);
  if (!pass) process.exitCode = 1;
}

function writeBlockedEnvironmentAggregate(
  identity: Readonly<Record<string, string>>,
  blockers: readonly string[],
  requestedRuns: number,
): void {
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const artifactDir = resolve("test-results/mtr-agent-fastgate", `aggregate-${stamp}-${identity.sha!.slice(0, 12)}`);
  mkdirSync(artifactDir, { recursive: true });
  const aggregate = {
    schemaVersion: "mtr-agent-fastgate-aggregate-v1.1",
    createdAt: new Date().toISOString(),
    exactRuntime: identity,
    requestedRuns,
    runCount: 0,
    releaseGate: "BLOCKED_BY_ENVIRONMENT",
    assessmentConfidence: "MEDIUM",
    confidenceCap: 84,
    blockers,
    invalidatedPriorDiagnosticResult: true,
    explanation: "The local macOS process runner is self-attested and cannot issue a strict FastGate HIGH verdict.",
    previewAcceptanceStatus: "BLOCKED_BY_ENVIRONMENT",
  } as const;
  writeFileSync(join(artifactDir, "aggregate.json"), `${JSON.stringify(aggregate, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(artifactDir, "report.md"), [
    "# MTR Agent FastGate v1.1 aggregate", "",
    "- LOCAL release gate: BLOCKED_BY_ENVIRONMENT",
    "- Assessment confidence: MEDIUM (cap 84)",
    `- Requested official runs: ${requestedRuns}; executed: 0`,
    "- Previous self-attested HIGH/PASS artifacts are invalidated.",
    "- Required blocker resolution: independent witnessed connectors, signed HTTP transcript, detached read-only build identity and disposable VM/container isolation.",
    "", "## Blockers", "", ...blockers.map((blocker) => `- ${blocker}`), "",
  ].join("\n"), { mode: 0o600 });
  process.stdout.write(`FASTGATE AGGREGATE: BLOCKED_BY_ENVIRONMENT\nAggregate artifacts: ${artifactDir}\n`);
  process.exitCode = 1;
}

function makeSandboxProfile(cwd: string): string {
  const home = process.env.HOME ?? "/Users/invalid";
  return [
    "(version 1)",
    "(allow default)",
    "(deny network-outbound)",
    "(allow network-outbound (remote ip \"localhost:*\"))",
    `(deny file-read* (subpath ${quote(`${home}/.ssh`)}) (subpath ${quote(`${home}/.aws`)}) (subpath ${quote(`${home}/.config/gcloud`)}) (literal ${quote(`${home}/.npmrc`)}) (literal ${quote(`${home}/.gitconfig`)}))`,
    `(deny file-write* (subpath ${quote(`${home}/.ssh`)}) (subpath ${quote(`${home}/.aws`)}) (subpath ${quote(`${home}/.config`)}) (subpath ${quote(`${home}/Documents`)}) )`,
    `(allow file-write* (subpath ${quote(cwd)}) (subpath ${quote(tmpdir())}))`,
  ].join("\n");
}

function sanitizedEnvironment(extra: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const denied = /(?:TOKEN|SECRET|PASSWORD|DATABASE_URL|VERCEL|AWS|AZURE|GOOGLE|OPENAI|ANTHROPIC|PROXY|SSH_AUTH_SOCK)/iu;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !denied.test(key)));
  return {
    ...env,
    NODE_ENV: process.env.NODE_ENV ?? "test",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    ...extra,
  };
}

function parseRuns(argv: readonly string[]): number {
  const index = argv.indexOf("--runs");
  if (index < 0) return FASTGATE_REQUIRED_OFFICIAL_RUNS;
  const value = Number(argv[index + 1]);
  if (value !== FASTGATE_REQUIRED_OFFICIAL_RUNS) throw new Error("OFFICIAL_FASTGATE_REQUIRES_EXACTLY_THREE_RUNS");
  return value;
}

function assertCleanTrackedTree(): void {
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim();
  if (dirty) throw new Error(`OFFICIAL_RUN_REQUIRES_CLEAN_TRACKED_TREE:${dirty.split("\n")[0]}`);
}

function trackedTreeHash(): string {
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 })
    .toString("utf8").split("\0").filter(Boolean).sort();
  const digest = createHash("sha256");
  for (const file of files) digest.update(file).update("\0").update(readFileSync(file)).update("\0");
  return digest.digest("hex");
}

function fileHash(path: string): string { return sha256(readFileSync(path)); }
function git(...args: string[]): string { return execFileSync("git", args, { encoding: "utf8" }).trim(); }
function quote(value: string): string { return JSON.stringify(value); }
function chmodTreeWritable(path: string): void { try { chmodSync(path, 0o700); } catch { /* already removed */ } }

main();

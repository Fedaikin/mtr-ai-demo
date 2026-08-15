import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "@/evals/fastgate/official/attestation";
import {
  createIndependentReviewWitnessSigner,
  parseCodexReviewJsonl,
} from "@/evals/fastgate/official/reviewer-witness";

const artifactDir = resolve(requiredEnv("FASTGATE_REVIEW_ARTIFACT_DIR"));
const inputPath = resolve(requiredEnv("FASTGATE_REVIEW_INPUT_PATH"));
const schemaPath = resolve(requiredEnv("FASTGATE_REVIEW_SCHEMA_PATH"));
const finalSha = requiredHash("FASTGATE_REVIEW_FINAL_SHA", 40);
const sourceTreeSha256 = requiredHash("FASTGATE_REVIEW_SOURCE_TREE_SHA256", 64);
const reviewerNonce = requiredHash("FASTGATE_REVIEWER_NONCE", 64);
const witnessScriptPath = fileURLToPath(import.meta.url);
const witnessScriptSha256 = fileSha(witnessScriptPath);

const inputArtifact = readJson<{
  reviewPrompt: string;
  reviewerNonceSha256: string;
}>(inputPath);
if (inputArtifact.reviewerNonceSha256 !== sha256(reviewerNonce)) {
  throw new Error("INDEPENDENT_REVIEW_NONCE_COMMITMENT_MISMATCH");
}
if (typeof inputArtifact.reviewPrompt !== "string" || !inputArtifact.reviewPrompt.trim()) {
  throw new Error("INDEPENDENT_REVIEW_PROMPT_MISSING");
}

const codex = resolveCodex();
const argv = [
  "exec", "--json", "--sandbox", "read-only", "--ephemeral", "--ignore-user-config",
  "--cd", process.cwd(), "--output-schema", schemaPath, "-",
] as const;
const codexVersion = `${basename(codex)} ${capture(codex, ["--version"])}`.trim();
const startedAt = new Date().toISOString();
const review = spawnSync(codex, argv, {
  input: `${inputArtifact.reviewPrompt}\nReviewer invocation nonce: ${reviewerNonce}\n`,
  encoding: "utf8",
  timeout: 30 * 60_000,
  maxBuffer: 30 * 1024 * 1024,
  env: sanitizedReviewerEnvironment(),
});
const finishedAt = new Date().toISOString();
const stdout = review.stdout ?? "";
const stderr = review.stderr ?? "";
if (review.status !== 0) throw new Error(`INDEPENDENT_REVIEW_FAILED:${review.status ?? "signal"}`);
const parsed = parseCodexReviewJsonl(stdout);
const outputBytes = Buffer.from(`${parsed.outputText}\n`);
const signer = createIndependentReviewWitnessSigner({
  finalSha,
  sourceTreeSha256,
  witnessScriptSha256,
  issuedAt: startedAt,
});
const envelope = signer.sign({
  inputCommitmentSha256: sha256(canonicalJson(inputArtifact)),
  codexExecutableSha256: fileSha(codex),
  codexVersion,
  commandArgvSha256: sha256(canonicalJson(argv)),
  startedAt,
  finishedAt,
  exitStatus: review.status,
  stdoutSha256: sha256(stdout),
  stderrSha256: sha256(stderr),
  reviewerSessionIdHash: sha256(parsed.threadId),
  outputSha256: sha256(outputBytes),
  findings: parsed.output.findings,
  verdict: parsed.output.verdict,
});

writeExclusive(resolve(artifactDir, "independent-review-codex.jsonl"), stdout);
writeExclusive(resolve(artifactDir, "independent-review-raw.json"), outputBytes);
writeExclusive(resolve(artifactDir, "independent-review.md"), `${parsed.outputText}\n`);
writeExclusive(resolve(artifactDir, "independent-review-witness.json"), `${JSON.stringify(envelope, null, 2)}\n`);
process.stdout.write(`INDEPENDENT_REVIEW_WITNESS:${envelope.certificate.keyId}\n`);

function sanitizedReviewerEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["HOME", "PATH", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM", "USER", "LOGNAME", "CODEX_HOME", "SSL_CERT_FILE", "SSL_CERT_DIR"];
  return Object.fromEntries(allowed.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]])) as NodeJS.ProcessEnv;
}

function resolveCodex(): string {
  const result = spawnSync("sh", ["-lc", "command -v codex"], { encoding: "utf8", env: sanitizedReviewerEnvironment() });
  const value = result.stdout?.trim();
  if (result.status !== 0 || !value || !existsSync(value)) throw new Error("BLOCKED_BY_ENVIRONMENT:READ_ONLY_REVIEWER_UNAVAILABLE");
  return resolve(value);
}

function capture(command: string, args: readonly string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8", env: sanitizedReviewerEnvironment() });
  if (result.status !== 0) throw new Error("INDEPENDENT_REVIEWER_IDENTITY_UNAVAILABLE");
  return result.stdout.trim();
}

function writeExclusive(path: string, value: string | Uint8Array): void {
  writeFileSync(path, value, { flag: "wx", mode: 0o600 });
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function requiredHash(name: string, length: number): string {
  const value = requiredEnv(name);
  if (!new RegExp(`^[a-f0-9]{${length}}$`, "u").test(value)) throw new Error(`${name}_INVALID`);
  return value;
}

function fileSha(path: string): string {
  return sha256(readFileSync(path));
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

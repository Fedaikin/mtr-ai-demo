import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export function resolveFastGateSeed(
  argv: readonly string[],
  deploymentSha: string,
  historyFile: string,
  random: () => string = () => randomBytes(32).toString("hex"),
): Readonly<{ seed: string; official: boolean }> {
  const index = argv.indexOf("--seed");
  if (index >= 0) {
    const seed = argv[index + 1]?.trim();
    if (!seed || seed.length < 16 || seed.length > 256) throw new Error("INVALID_REPRODUCTION_SEED");
    return { seed, official: false };
  }
  const history = readSeedHistory(historyFile);
  let seed = random();
  for (let attempt = 0; history[deploymentSha] === seed && attempt < 4; attempt += 1) seed = random();
  if (history[deploymentSha] === seed) throw new Error("OFFICIAL_SEED_REUSE_BLOCKED");
  history[deploymentSha] = seed;
  writeFileSync(historyFile, JSON.stringify(history), { mode: 0o600 });
  return { seed, official: true };
}

export function checksumDecision(before: string, after: string, previousChanges: number): "PASS" | "RETRY_ONCE" | "INVALID_ENVIRONMENT" {
  if (before === after) return "PASS";
  return previousChanges === 0 ? "RETRY_ONCE" : "INVALID_ENVIRONMENT";
}

export function runtimeExceeded(startedAt: number, now: number, limitMs: number): boolean {
  return now - startedAt > limitMs;
}

function readSeedHistory(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, string> : {};
  } catch {
    throw new Error("INVALID_SEED_HISTORY");
  }
}

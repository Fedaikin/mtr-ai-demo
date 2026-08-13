import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const projectRoot = resolve(process.cwd());
const candidateRoots = [
  "src",
  "docs",
  "fixtures",
  "public",
  "drizzle",
  "prompts",
  "evals",
  "tests",
  "scripts",
  ".github",
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "Dockerfile",
  "components.json",
  "docker-compose.yml",
  "drizzle.config.ts",
  "eslint.config.mjs",
  "next.config.ts",
  "package.json",
  "playwright.config.ts",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "postcss.config.mjs",
  "tsconfig.json",
  "vitest.config.ts",
];
const ignoredSegments = new Set(["node_modules", ".next", ".git", "output"]);
const textExtensions = new Set([
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".mts",
  ".sql",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

interface Finding {
  path: string;
  type: "email" | "phone" | "forbidden-marker";
}

const contactChecks: Array<{
  type: Finding["type"];
  pattern: RegExp;
}> = [
  {
    type: "email",
    pattern: /[\p{L}\p{N}.%+_-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu,
  },
  {
    type: "phone",
    pattern: /(?<!\d)(?:\+7|8)[\s(.-]*\d{3}[\s)./-]*\d{3}[\s./-]*\d{2}[\s./-]*\d{2}(?!\d)/gu,
  },
];

const builtInForbiddenMarkers = [
  ["REAL", "PERSON", "NAME"].join("_"),
  ["REAL", "CONTACT", "DATA"].join("_"),
  ["REAL", "EMAIL", "ADDRESS"].join("_"),
  ["REAL", "PHONE", "NUMBER"].join("_"),
  ["COPY", "FROM", "SOURCE", "TZ"].join("_"),
];

function hasIgnoredSegment(filePath: string): boolean {
  return filePath.split(/[\\/]/u).some((segment) => ignoredSegments.has(segment));
}

function isTextCandidate(filePath: string): boolean {
  return !hasIgnoredSegment(filePath) && textExtensions.has(extname(filePath).toLowerCase());
}

function gitCandidates(): string[] | undefined {
  try {
    const stdout = execFileSync(
      "git",
      ["-c", "core.fsmonitor=false", "ls-files", "--cached", "--others", "--exclude-standard", "--", ...candidateRoots],
      { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 },
    );
    return stdout.split(/\r?\n/u).filter(Boolean);
  } catch {
    return undefined;
  }
}

async function walk(pathFromRoot: string): Promise<string[]> {
  if (hasIgnoredSegment(pathFromRoot)) return [];
  const absolutePath = resolve(projectRoot, pathFromRoot);

  try {
    const entries = await readdir(absolutePath, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((entry) => walk(`${pathFromRoot}/${entry.name}`)),
    );
    return nested.flat();
  } catch {
    return [pathFromRoot];
  }
}

async function candidateFiles(): Promise<string[]> {
  const fromGit = gitCandidates();
  const candidates = fromGit ?? (await Promise.all(candidateRoots.map(walk))).flat();
  return [...new Set(candidates.filter(isTextCandidate))].sort();
}

function configuredForbiddenMarkers(): string[] {
  return (process.env.PRIVACY_FORBIDDEN_MARKERS ?? "")
    .split(/[\n,]/u)
    .map((marker) => marker.trim())
    .filter(Boolean);
}

function scanFile(filePath: string): Finding[] {
  const contents = readFileSync(resolve(projectRoot, filePath), "utf8");
  if (contents.includes("\0")) return [];

  const findings: Finding[] = [];
  for (const check of contactChecks) {
    check.pattern.lastIndex = 0;
    if (check.pattern.test(contents)) findings.push({ path: filePath, type: check.type });
  }

  const normalizedContents = contents.toLocaleLowerCase("ru-RU");
  const forbiddenMarkers = [...builtInForbiddenMarkers, ...configuredForbiddenMarkers()];
  if (
    forbiddenMarkers.some((marker) =>
      normalizedContents.includes(marker.toLocaleLowerCase("ru-RU")),
    )
  ) {
    findings.push({ path: filePath, type: "forbidden-marker" });
  }

  return findings;
}

async function main(): Promise<void> {
  const files = await candidateFiles();
  const findings: Finding[] = [];
  for (const file of files) findings.push(...scanFile(file));
  const uniqueFindings = [
    ...new Map(findings.map((finding) => [`${finding.path}:${finding.type}`, finding])).values(),
  ];

  if (uniqueFindings.length > 0) {
    process.stderr.write("Privacy scan failed. Sensitive values are intentionally suppressed.\n");
    for (const finding of uniqueFindings) {
      process.stderr.write(
        `${relative(projectRoot, resolve(projectRoot, finding.path))}: ${finding.type}\n`,
      );
    }
    process.exitCode = 1;
  } else {
    process.stdout.write(`Privacy scan passed: ${files.length} candidate files checked.\n`);
  }
}

void main();

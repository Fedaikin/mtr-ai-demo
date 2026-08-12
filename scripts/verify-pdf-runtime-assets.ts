import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const PDF_FONT_RUNTIME_PATHS = [
  "node_modules/@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff",
  "node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff",
] as const;

async function main(): Promise<void> {
  const routeTracePath = resolve(
    ".next/server/app/api/reports/[runId]/export/route.js.nft.json",
  );
  const routeTrace = JSON.parse(await readFile(routeTracePath, "utf8")) as {
    files?: unknown;
  };
  if (!Array.isArray(routeTrace.files)) {
    throw new Error(`PDF export route trace has no files array: ${routeTracePath}`);
  }

  const tracedFiles = routeTrace.files.filter(
    (value): value is string => typeof value === "string",
  ).map((value) => value.replaceAll("\\", "/"));

  for (const runtimePath of PDF_FONT_RUNTIME_PATHS) {
    const isTracedAtRuntimePath = tracedFiles.some((tracedPath) =>
      tracedPath.endsWith(runtimePath) && !tracedPath.includes("node_modules/.pnpm/"),
    );
    if (!isTracedAtRuntimePath) {
      throw new Error(`PDF font is not traced at its top-level runtime path: ${runtimePath}`);
    }
  }

  const requiredServerFiles = JSON.parse(
    await readFile(resolve(".next/required-server-files.json"), "utf8"),
  ) as { config?: { output?: unknown } };
  if (requiredServerFiles.config?.output === "standalone") {
    for (const runtimePath of PDF_FONT_RUNTIME_PATHS) {
      await access(resolve(".next/standalone", runtimePath));
    }
  }

  console.log(
    `Verified ${PDF_FONT_RUNTIME_PATHS.length} PDF font runtime assets in the fresh Next.js build trace${
      requiredServerFiles.config?.output === "standalone" ? " and standalone bundle" : ""
    }.`,
  );
}

void main();

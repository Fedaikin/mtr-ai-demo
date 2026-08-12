import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("ACC-AIUX-002: обязательная provenance заголовка отчёта", () => {
  it("показывает пользователя, локализованное состояние и сценарий", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/app/reports/[runId]/page.tsx"),
      "utf8",
    );

    expect(source).toContain("Пользователь: ${report.user}");
    expect(source).toContain("runStatusLabel(report.status)");
    expect(source).toContain("scenarioLabel(report.scenarioId)");
  });
});

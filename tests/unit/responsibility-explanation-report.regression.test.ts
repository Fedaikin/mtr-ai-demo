import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("ACC-FUNC-003: объяснение ответственности в отчётах", () => {
  it("выводит persisted explanation в web, XLSX и PDF", async () => {
    const [table, exportService] = await Promise.all([
      readFile(resolve(process.cwd(), "src/components/report-table.tsx"), "utf8"),
      readFile(resolve(process.cwd(), "src/application/report-service.ts"), "utf8"),
    ]);

    expect(table).toContain("Обоснование: {result.responsibilityExplanation}");
    expect(exportService).toContain('"Объяснение ответственности": result.responsibilityExplanation');
    expect(exportService).toContain("cursor = drawPdfResultCard(document, fonts, report, cursor");
    expect(exportService).toContain("wrapPdfText(explanationText, fonts, 7.2, 515)");
  });
});

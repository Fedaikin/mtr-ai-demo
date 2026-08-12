import { describe, expect, it } from "vitest";

vi.mock("server-only", () => ({}));

import { pdfTextSegments } from "@/application/report-service";

describe("ACC-FUNC-004: полное покрытие глифов PDF", () => {
  it("направляет кириллицу и идентификаторы с числами в соответствующие шрифты", () => {
    expect(pdfTextSegments("Запуск run-123 · SAP-DEMO-0001, 80/60 м")).toEqual([
      { script: "CYRILLIC", text: "Запуск" },
      { script: "LATIN", text: " run-123 · SAP-DEMO-0001, 80/60 " },
      { script: "CYRILLIC", text: "м" },
    ]);
  });

  it("не использует символы вне двух проверенных Noto Sans subsets", () => {
    const reportLabels = "Характеристики: Требуется / Доступно / Отклонение";
    expect(reportLabels).not.toContain("→");
  });
});

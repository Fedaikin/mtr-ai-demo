import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

vi.mock("server-only", () => ({}));

import { exportReportPdf, exportReportXlsx, type ReportView } from "@/application/report-service";

describe("ACC-FUNC-005: обязательная provenance экспортов", () => {
  it("показывает пользователя, состояние и версии Appius в XLSX и PDF", async () => {
    const report = reportFixture();
    const workbook = XLSX.read(await exportReportXlsx(report), { type: "array" });
    const visibleCells = workbook.SheetNames.flatMap((name) => {
      const sheet = workbook.Sheets[name];
      return sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 }).flat() : [];
    }).join(" ");
    expect(visibleCells).toContain("Демо-пользователь 1");
    expect(visibleCells).toContain("Завершено");
    expect(visibleCells).toContain("spec-demo-piping-001-v3");

    const { extractText, getDocumentProxy } = await import("unpdf");
    const proxy = await getDocumentProxy(await exportReportPdf(report));
    const extracted = await extractText(proxy, { mergePages: true });
    const text = String(extracted.text);
    expect(text).toContain("Демо-пользователь 1");
    expect(text).toContain("Завершено");
    expect(text).toContain("spec-demo-piping-001-v3");
  });
});

function reportFixture(): ReportView {
  return {
    schemaVersion: "1.1.0",
    runId: "run-provenance-001",
    scenarioId: "scenario-full-analysis",
    generatedAt: "2026-08-12T10:00:00.000Z",
    user: "Демо-пользователь 1",
    status: "COMPLETED",
    summary: {
      total: 0,
      exact: 0,
      found: 0,
      likely: 0,
      review: 0,
      noMatch: 0,
      analogues: 0,
      insufficient: 0,
      procurement: 0,
      customerResponsibility: 0,
      contractorResponsibility: 0,
    },
    results: [],
    analogueOptions: [],
    provenance: {
      appius: "2026-08-12T09:00:00.000Z",
      appiusVersions: [{ versionId: "spec-demo-piping-001-v3", versionNumber: 3 }],
      sap: "2026-08-12T09:05:00.000Z",
      normative: "DEMO_RULES_VERSIONED",
      prompt: { version: "1.0.0" },
      responsibilityRules: [{ documentId: "KT-DEMO", version: "1", clauseId: "2.1" }],
      analogueRules: [{ documentId: "TU-DEMO", version: "1", clauseId: "4.2" }],
    },
    isSyntheticDemo: true,
  };
}

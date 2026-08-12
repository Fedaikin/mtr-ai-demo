import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReportTable } from "@/components/report-table";
import { StatusPill } from "@/components/status-pill";
import { RUN_STATUSES, type PositionAnalysisResult } from "@/domain/models";
import { findRawUserEnums } from "@/lib/localization";

describe("локализация пользовательского интерфейса отчёта", () => {
  it("не показывает необработанные статусы на основном экране отчёта", () => {
    const html = renderToStaticMarkup(
      <ReportTable
        runId="run-demo"
        summary={{
          total: 1,
          exact: 1,
          found: 1,
          likely: 0,
          review: 0,
          noMatch: 0,
          analogues: 0,
          insufficient: 0,
          procurement: 0,
          customerResponsibility: 1,
          contractorResponsibility: 0,
        }}
        results={[analysisResult()]}
        analogueOptions={[]}
        provenance={{}}
      />,
    );
    const text = visibleText(html);

    expect(text).toContain("Точное совпадение");
    expect(text).toContain("Найдено на складе");
    expect(text).toContain("Заказчик");
    expect(text).toContain("Варианты аналогов");
    expect(findRawUserEnums(text)).toEqual([]);
  });

  it("локализует каждый статус запуска в общей плашке", () => {
    const html = renderToStaticMarkup(
      <div>{RUN_STATUSES.map((status) => <StatusPill key={status} status={status} />)}</div>,
    );
    expect(findRawUserEnums(visibleText(html))).toEqual([]);
    expect(visibleText(html)).toContain("Загрузка данных из Appius PLM");
    expect(visibleText(html)).toContain("Синхронизация с SAP S/4HANA");
  });
});

function analysisResult(): PositionAnalysisResult {
  return {
    position: {
      id: "position-demo",
      userId: "demo-user-001",
      internalCode: "APP-DEMO-001",
      nameRu: "Демонстрационная позиция",
      synonyms: [],
      equipmentType: "PIPE",
      dimensions: {},
      requiredQuantity: 1,
      unit: "шт.",
      specificationId: "spec-demo",
      versionId: "spec-demo-v1",
      versionNumber: 1,
      isCurrentVersion: true,
      classification: {},
      access: {},
    },
    responsibility: "CUSTOMER",
    responsibilityConfidence: 1,
    responsibilityCitation: {
      documentId: "ПРАВИЛО-ДЕМО-1",
      version: "1.0",
      clauseId: "1.1",
      title: "Демонстрационное правило",
      isSyntheticDemo: true,
    },
    match: {
      score: 100,
      category: "EXACT",
      material: null,
      matched: ["Наименование"],
      differences: [],
      requiresHumanReview: false,
    },
    status: "FOUND",
    requiresHumanReview: false,
  };
}

function visibleText(html: string): string {
  return html.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ");
}

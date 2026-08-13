import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

vi.mock("server-only", () => ({}));

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase } from "@/adapters/persistence/db";
import {
  exportReportJson,
  exportReportPdf,
  exportReportXlsx,
  getReport,
  type ReportView,
} from "@/application/report-service";
import { findRawUserEnums } from "@/lib/localization";
import { ScenarioService } from "@/application/scenario-service";
import { DEMO_USER_ID, type ScenarioRun } from "@/domain/models";
import { MTR_AGENT_UNIVERSAL_VERSION } from "@/application/agent-orchestrator/system-prompt";

describe.sequential("report exports", () => {
  let report: ReportView;

  beforeAll(async () => {
    await resetDemoDatabase(DEMO_USER_ID);
    const service = await ScenarioService.create();
    const created = await service.createRun(DEMO_USER_ID, {
      scenarioId: "scenario-full-analysis",
      specificationId: "ALL_CURRENT_SPECIFICATIONS",
      mode: "NORMAL",
      seed: "BASE",
    });
    const completed = await driveToCompletion(service, created);
    ({ report } = await getReport(DEMO_USER_ID, completed.id));
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("creates a non-empty, versioned JSON export with all 24 results", async () => {
    const bytes = await exportReportJson(report);
    const text = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(text) as {
      schemaVersion: string;
      runId: string;
      scenarioId: string;
      status: string;
      user: string;
      isSyntheticDemo: true;
      summary: ReportView["summary"];
      results: Array<{
        responsibility: string;
        status: string;
        match: { category: string };
        analogueCoverage?: {
          allocations: Array<{ verdict: string }>;
          primaryPlan?: { allocations: Array<{ verdict: string }> };
          alternativePlans?: Array<{ allocations: Array<{ verdict: string }> }>;
        };
      }>;
      analogueOptions: Array<{
        positionCode: string;
        searchOutcome: string | null;
        searchOutcomeLabel: string | null;
        directCoveredQuantity: number;
        analogueCoveredQuantity: number;
        shortageQuantity: number;
        primary: {
          kind: string;
          components: Array<{ verdict: string; score: number }>;
        } | null;
        alternatives: Array<{ kind: string; components: unknown[] }>;
      }>;
      provenance: Record<string, unknown>;
    };

    expect(bytes.byteLength).toBeGreaterThan(10_000);
    expect(text.endsWith("\n")).toBe(true);
    expect(parsed).toMatchObject({
      schemaVersion: "1.1.0",
      runId: report.runId,
      scenarioId: "scenario-full-analysis",
      status: "Завершено",
      isSyntheticDemo: true,
      summary: { total: 24, exact: 8, likely: 8, review: 5, noMatch: 3 },
    });
    expect(parsed.results).toHaveLength(24);
    expect(parsed.analogueOptions).toHaveLength(7);
    expect(parsed.analogueOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        primary: expect.objectContaining({
          kind: "Основной план покрытия",
          components: expect.arrayContaining([
            expect.objectContaining({
              verdict: expect.stringMatching(/Подходит|Требуется экспертная проверка|Не рекомендуется/u),
              score: expect.any(Number),
            }),
          ]),
        }),
      }),
    ]));
    expect(parsed.analogueOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        positionCode: "APP-DEMO-PIPE-009",
        searchOutcome: "Нет применимого нормативного правила",
        searchOutcomeLabel: "Нет применимого нормативного правила",
        directCoveredQuantity: 60,
        analogueCoveredQuantity: 0,
        shortageQuantity: 20,
        primary: null,
      }),
      expect.objectContaining({
        positionCode: "APP-DEMO-CHECK-012",
        searchOutcome: "Нет применимого нормативного правила",
        directCoveredQuantity: 2,
        shortageQuantity: 4,
        primary: null,
      }),
      expect.objectContaining({
        positionCode: "APP-DEMO-GAUGE-016",
        searchOutcome: "Нет применимого нормативного правила",
        directCoveredQuantity: 7,
        shortageQuantity: 3,
        primary: null,
      }),
      expect.objectContaining({
        positionCode: "APP-DEMO-MOTOR-018",
        searchOutcome: "Допустимый аналог не найден",
        directCoveredQuantity: 1,
        shortageQuantity: 1,
        primary: null,
      }),
    ]));
    expect(parsed.results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        analogueCoverage: expect.objectContaining({
          primaryPlan: expect.objectContaining({ allocations: expect.any(Array) }),
          alternativePlans: expect.any(Array),
        }),
      }),
    ]));
    expect(parsed.results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        responsibility: expect.stringMatching(/Заказчик|Подрядчик/u),
        status: expect.stringMatching(/Найдено на складе|Покрыто аналогами|Недостаточное количество/u),
        match: expect.objectContaining({
          category: expect.stringMatching(/Точное совпадение|Вероятное совпадение|Требуется проверка|Не найдено/u),
        }),
      }),
    ]));
    expect(findRawUserEnums(text), rawEnumContexts(text)).toEqual([]);
    expect(parsed.provenance).toEqual(
      expect.objectContaining({
        appius: expect.any(String),
        appiusVersions: expect.arrayContaining([
          expect.objectContaining({ versionId: expect.any(String), versionNumber: expect.any(Number) }),
        ]),
        sap: expect.any(String),
        normative: "DEMO_RULES_VERSIONED",
        prompt: expect.objectContaining({
          version: MTR_AGENT_UNIVERSAL_VERSION,
          checksum: expect.any(String),
        }),
        responsibilityRules: expect.arrayContaining([
          expect.objectContaining({ documentId: expect.any(String), version: expect.any(String) }),
        ]),
        analogueRules: expect.arrayContaining([
          expect.objectContaining({ documentId: expect.any(String), version: expect.any(String) }),
        ]),
      }),
    );
  });

  it("creates a valid XLSX workbook with all required content sheets", async () => {
    const bytes = await exportReportXlsx(report);

    expect(bytes.byteLength).toBeGreaterThan(5_000);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);

    const workbook = XLSX.read(bytes, { type: "array" });

    expect(workbook.SheetNames).toEqual([
      "Сводка",
      "Позиции",
      "Варианты аналогов",
      "Экспертная проверка",
      "Источники",
    ]);
    expect(sheetRows(workbook, "Сводка")).toHaveLength(8);
    expect(sheetRows(workbook, "Позиции")).toHaveLength(25);
    const analogueRows = sheetRows(workbook, "Варианты аналогов");
    expect(analogueRows.length).toBeGreaterThan(1);
    expect(analogueRows[0]).toEqual(expect.arrayContaining([
      "Исходная позиция",
      "Требуемая позиция",
      "Причина поиска",
      "Вариант покрытия",
      "Компонент покрытия",
      "Характеристика",
      "Требуется",
      "Доступно",
      "Отклонение",
      "Склад",
      "Покрытие варианта",
      "Пункт правила",
      "Соответствие, %",
      "Вывод",
      "Объяснение",
      "Остаток после расчётного распределения",
    ]));
    expect(analogueRows).toEqual(expect.arrayContaining([
      expect.arrayContaining(["Основной план покрытия"]),
      expect.arrayContaining(["Альтернативный план покрытия"]),
      expect.arrayContaining([
        "APP-DEMO-PIPE-009",
        "Нет применимого нормативного правила",
        60,
        0,
        20,
      ]),
      expect.arrayContaining([
        "APP-DEMO-MOTOR-018",
        "Допустимый аналог не найден",
        1,
        0,
        1,
      ]),
    ]));
    expect(sheetRows(workbook, "Экспертная проверка").length).toBeGreaterThan(1);
    const sourceRows = sheetRows(workbook, "Источники");
    expect(sourceRows).toEqual(expect.arrayContaining([
      expect.arrayContaining(["Системный промпт", MTR_AGENT_UNIVERSAL_VERSION]),
      expect.arrayContaining(["Правила ответственности"]),
      expect.arrayContaining(["Правила аналогов"]),
    ]));
    const allVisibleCells = workbook.SheetNames.flatMap((name) => sheetRows(workbook, name))
      .flat()
      .join(" ");
    expect(findRawUserEnums(allVisibleCells), rawEnumContexts(allVisibleCells)).toEqual([]);
  });

  it("creates a parseable non-empty PDF with report metadata and pages", async () => {
    const bytes = await exportReportPdf(report);

    expect(bytes.byteLength).toBeGreaterThan(5_000);
    expect(new TextDecoder("latin1").decode(bytes.slice(0, 8))).toMatch(/^%PDF-1\./);

    const { PDFDocument } = await import("pdf-lib");
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThan(0);
    expect(document.getTitle()).toBe(`Отчёт МТР ${report.runId}`);
    expect(document.getAuthor()).toBe("Демо-система анализа МТР");

    const { extractText, getDocumentProxy } = await import("unpdf");
    const proxy = await getDocumentProxy(bytes);
    const extracted = await extractText(proxy, { mergePages: true });
    const text = String(extracted.text);
    expect(text).toContain("Легенда статусов");
    expect(text).toContain("Варианты аналогов");
    expect(text).toContain("Основной план покрытия");
    expect(text).toContain("Альтернативный план покрытия");
    expect(text).toContain("Компонент покрытия");
    expect(text).toContain("Требуется");
    expect(text).toContain("Доступно");
    expect(text).toContain("Отклонение");
    expect(text).toContain("остаток после расчётного распределения");
    expect(findRawUserEnums(text), rawEnumContexts(text)).toEqual([]);
  });
});

async function driveToCompletion(service: ScenarioService, initial: ScenarioRun): Promise<ScenarioRun> {
  let run = initial;
  for (let step = 0; step < 12 && run.status !== "COMPLETED"; step += 1) {
    if (["FAILED", "CANCELLED"].includes(run.status)) break;
    run = await service.advance(DEMO_USER_ID, run.id, run.version);
  }
  expect(run.status).toBe("COMPLETED");
  return run;
}

function sheetRows(workbook: XLSX.WorkBook, name: string): unknown[][] {
  const sheet = workbook.Sheets[name];
  expect(sheet, `missing worksheet ${name}`).toBeDefined();
  return XLSX.utils.sheet_to_json(sheet!, { header: 1 }) as unknown[][];
}

function rawEnumContexts(text: string): string {
  return findRawUserEnums(text)
    .map((raw) => {
      const match = new RegExp(`(?<![\\p{L}\\p{N}_-])(?<![A-Z0-9]\\.)${raw}(?![\\p{L}\\p{N}_-])`, "u").exec(text);
      const index = match?.index ?? text.indexOf(raw);
      return `${raw}: ${text.slice(Math.max(0, index - 60), index + raw.length + 60)}`;
    })
    .join("\n");
}

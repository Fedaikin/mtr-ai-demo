import "server-only";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { getRepository } from "@/adapters/persistence/repository";
import { requirePermission, resolveAuthorizationContext } from "@/application/authorization-service";
import type { PositionAnalysisResult, ReportSummary, ScenarioRun } from "@/domain/models";
import {
  effectiveResponsibilityDecisionState,
  summarizeResponsibilityDecisions,
} from "@/domain/responsibility";
import {
  analysisStatusLabel,
  analogueVerdictLabel,
  characteristicLabel,
  ENUM_LABELS,
  localizeKnownEnum,
  localizeKnownEnumsInText,
  matchCategoryLabel,
  recommendationKindLabel,
  responsibilityLabel,
  runStatusLabel,
  scenarioLabel,
} from "@/lib/localization";
import {
  buildPositionAnalogueViews,
  type PositionAnalogueView,
} from "@/lib/report-analogues";

export interface ReportView {
  schemaVersion: string;
  runId: string;
  scenarioId: string;
  generatedAt: string;
  user: string;
  status: "COMPLETED";
  summary: ReportSummary;
  results: PositionAnalysisResult[];
  analogueOptions: PositionAnalogueView[];
  provenance: Record<string, unknown>;
  isSyntheticDemo: true;
}

export async function getReport(userId: string, runId: string): Promise<{ run: ScenarioRun; report: ReportView }> {
  const context = await resolveAuthorizationContext(userId);
  const projectId = context.activeProjectId;
  if (!projectId) throw new ReportError(404, "RUN_NOT_FOUND", "Запуск не найден");
  requirePermission(context, "report.read", {
    resourceType: "SCENARIO_RUN_REPORT",
    resourceId: runId,
    projectId,
  });
  const repository = await getRepository();
  const run = await repository.getScenarioRunInProject(userId, projectId, runId);
  if (!run) throw new ReportError(404, "RUN_NOT_FOUND", "Запуск не найден");
  const report = run.outputSnapshot.report;
  if (run.status !== "COMPLETED" || !isReportView(report)) throw new ReportError(409, "REPORT_NOT_READY", "Отчёт ещё не сформирован");
  const records = await repository.listAnalysisResultsInProject(userId, projectId, runId);
  const persistedResults: PositionAnalysisResult[] = records.flatMap((record) =>
    isPositionAnalysisResult(record.result)
      ? [{
          ...record.result,
          responsibilityDecisionState: record.responsibilityDecisionState,
          responsibility: record.responsibility,
          responsibilityConfidence: record.responsibilityConfidence,
          responsibilityCitation: record.responsibilityCitation as PositionAnalysisResult["responsibilityCitation"],
          requiresHumanReview: record.requiresHumanReview,
          analysisVersion: record.version,
        }]
      : [],
  );
  const results = persistedResults.length === report.results.length
    ? persistedResults
    : report.results;

  const currentReport: ReportView = {
    ...structuredClone(report),
    schemaVersion: "1.1.0",
    results,
    analogueOptions: buildPositionAnalogueViews(results),
    summary: summarizeCurrentResults(results),
    provenance: {
      ...report.provenance,
      latestResultVersion: Math.max(...records.map((record) => record.version), 1),
      manualResponsibilityOverrides: results.reduce(
        (total, result) => total + (result.manualResponsibilityOverrides?.length ?? 0),
        0,
      ),
    },
  };
  return { run, report: currentReport };
}

export async function exportReportJson(report: ReportView): Promise<Uint8Array> {
  return new TextEncoder().encode(`${JSON.stringify(createLocalizedReportExport(report), null, 2)}\n`);
}

export async function exportReportXlsx(report: ReportView): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const summary = XLSX.utils.aoa_to_sheet([
    ["Показатель", "Значение"],
    ["Всего позиций", report.summary.total], ["Точные совпадения", report.summary.exact], ["Вероятные", report.summary.likely],
    ["Экспертная проверка", report.summary.review], ["Без прямого совпадения", report.summary.noMatch],
    ["Аналоги", report.summary.analogues], ["Требуется закупка", report.summary.procurement],
  ]);
  summary["!cols"] = [{ wch: 34 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(workbook, summary, "Сводка");

  const details = XLSX.utils.json_to_sheet(report.results.map((result) => ({
    "Код позиции": result.position.internalCode,
    "Наименование": result.position.nameRu,
    "Спецификация": result.position.specificationName,
    "Количество": result.position.requiredQuantity,
    "Ед.": result.position.unit,
    "Ответственность": responsibilityDecisionLabel(result),
    "Объяснение ответственности": result.responsibilityExplanation ?? "—",
    "Категория": matchCategoryLabel(result.match.category),
    "Соответствие, %": result.match.score,
    "Материал SAP": result.match.material?.materialCode ?? "—",
    "Остаток": result.match.material?.availableQuantity ?? 0,
    "Статус": analysisStatusLabel(result.status),
    "Покрытие аналогами": result.analogueCoverage ? `${result.analogueCoverage.coveredQuantity} / ${result.analogueCoverage.requiredQuantity}` : "—",
    "Правило": responsibilityCitationLabel(result),
    "Проверка эксперта": result.requiresHumanReview ? "Да" : "Нет",
    "Ручная корректировка": result.manualResponsibilityOverrides?.length ? "Да" : "Нет",
  })));
  details["!cols"] = [24, 42, 28, 14, 9, 20, 58, 16, 10, 22, 13, 18, 22, 26, 18, 21].map((wch) => ({ wch }));
  details["!autofilter"] = { ref: details["!ref"] ?? "A1:P1" };
  XLSX.utils.book_append_sheet(workbook, details, "Позиции");

  const analogueRows = report.analogueOptions.flatMap<Record<string, string | number>>((position) => {
    if (position.plans.length === 0) {
      return [{
        "Исходная позиция": position.positionCode,
        "Требуемая позиция": position.positionName,
        "Причина поиска": position.reason,
        "Результат поиска": position.searchOutcomeLabel ?? "Подходящий план не найден",
        "Прямое покрытие": position.directCoveredQuantity,
        "Покрытие аналогами": position.analogueCoveredQuantity,
        "Незакрытый дефицит": position.shortageQuantity,
        "Требуемое количество": position.requiredQuantity,
        "Ед.": position.unit,
        "Применимых правил": position.searchRuleCount,
        "Покрытие варианта": position.combinedCoverageLabel,
      }];
    }
    return position.plans.flatMap((plan) =>
      plan.components.flatMap((component) => {
        const deviations = component.deviations.length > 0
          ? component.deviations
          : [{
              characteristic: "—",
              characteristicLabel: "Характеристики не заданы",
              required: "—",
              available: "—",
              deviation: "нет",
              differs: false,
            }];
        return deviations.map((deviation) => ({
          "Исходная позиция": position.positionCode,
          "Требуемая позиция": position.positionName,
          "Причина поиска": position.reason,
          "Вариант покрытия": recommendationKindLabel(plan.kind),
          "Номер варианта": plan.rank,
          "Компонент покрытия": component.componentIndex,
          "Код материала": component.materialCode,
          "Название материала": component.materialName,
          "Характеристика": deviation.characteristicLabel,
          "Требуется": deviation.required,
          "Доступно": deviation.available,
          "Отклонение": deviation.differs ? deviation.deviation : "Нет",
          "Требуемое количество": component.requiredQuantity,
          "Покрыто вариантом": plan.coveredQuantity,
          "Недостаток варианта": plan.shortageQuantity,
          "Доступно у компонента": component.availableQuantity,
          "Выделено компоненту": component.allocatedQuantity,
          "Ед.": component.unit,
          "Склад": `${component.plant} / ${component.warehouse}`,
          "Покрытие варианта": plan.coverageLabel,
          "Нормативное основание": component.citation.documentId,
          "Пункт правила": component.citation.clauseId,
          "Соответствие, %": component.score,
          "Вывод": component.verdictLabel,
          "Объяснение": component.explanation,
          "Остаток после расчётного распределения": component.remainingAfterReservation,
        }));
      }),
    );
  });
  const analogues = XLSX.utils.json_to_sheet(
    analogueRows.length > 0
      ? analogueRows
      : [{ "Исходная позиция": "Позиции для поиска аналогов отсутствуют" }],
  );
  analogues["!cols"] = [22, 42, 48, 32, 16, 20, 22, 42, 30, 20, 20, 22, 22, 22, 22, 24, 22, 9, 28, 72, 26, 18, 18, 32, 72, 36]
    .map((wch) => ({ wch }));
  analogues["!autofilter"] = { ref: analogues["!ref"] ?? "A1:Z1" };
  XLSX.utils.book_append_sheet(workbook, analogues, "Варианты аналогов");

  const reviewRows = report.results.filter((result) => result.requiresHumanReview).map((result) => ({
    "Код позиции": result.position.internalCode,
    "Наименование": result.position.nameRu,
    "Категория": matchCategoryLabel(result.match.category),
    "Соответствие, %": result.match.score,
    "Различия": result.match.differences.map(localizeKnownEnumsInText).join("; ") || "—",
    "Ответственность": responsibilityDecisionLabel(result),
    "Документ": result.responsibilityCitation?.documentId ?? "—",
    "Пункт": result.responsibilityCitation?.clauseId ?? "—",
    "Ручное решение": result.manualResponsibilityOverrides?.at(-1)?.reason ?? "—",
  }));
  const review = XLSX.utils.json_to_sheet(reviewRows.length > 0 ? reviewRows : [{ "Код позиции": "Экспертная проверка не требуется" }]);
  review["!cols"] = [24, 42, 16, 10, 55, 20, 24, 16, 48].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, review, "Экспертная проверка");

  const sources = XLSX.utils.aoa_to_sheet([
    ["Источник", "Версия / снимок", "Назначение"],
    ["Пользователь", report.user, "Владелец результатов и выгрузки"],
    ["Состояние сценария", runStatusLabel(report.status), scenarioLabel(report.scenarioId)],
    ["Сформирован", formatReportGeneratedAt(report.generatedAt), "Дата и время итогового отчёта"],
    ["Демо Appius PLM", String(report.provenance.appius ?? "—"), "Актуальные спецификации и позиции"],
    ["Демо SAP S/4HANA", String(report.provenance.sap ?? "—"), "Материалы и складские остатки"],
    ["Демо нормативного хранилища", String(report.provenance.normative ?? "—"), "Ответственность и допустимость аналогов"],
    ["Системный промпт", provenancePromptVersion(report.provenance), "Инструкции проектного AI-агента"],
    ["Правила ответственности", provenanceRuleVersions(report.provenance, "responsibilityRules"), "Версии документов и пунктов"],
    ["Правила аналогов", provenanceRuleVersions(report.provenance, "analogueRules"), "Версии документов и пунктов"],
    ["Версии Appius PLM", provenanceAppiusVersions(report.provenance), "Идентификаторы неизменяемых версий спецификаций"],
    ["Запуск сценария", report.runId, "Неизменяемый входной снимок и журнал шагов"],
  ]);
  sources["!cols"] = [{ wch: 30 }, { wch: 36 }, { wch: 54 }];
  XLSX.utils.book_append_sheet(workbook, sources, "Источники");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true });
  return new Uint8Array(bytes);
}

export async function exportReportPdf(report: ReportView): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const [cyrillicBytes, latinBytes] = await Promise.all([
    readFile(resolve(process.cwd(), "node_modules/@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff")),
    readFile(resolve(process.cwd(), "node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff")),
  ]);
  const fonts: PdfFonts = {
    cyrillic: await document.embedFont(cyrillicBytes, { subset: true }),
    latin: await document.embedFont(latinBytes, { subset: true }),
  };
  document.setTitle(`Отчёт МТР ${report.runId}`);
  document.setAuthor("Демо-система анализа МТР");

  const page = addPage(document, fonts, report);
  let y = 724;
  drawPdfMixedText(page, `Пользователь: ${report.user} · Состояние: ${runStatusLabel(report.status)}`, fonts, { x: 38, y, size: 8, color: rgb(0.25, 0.31, 0.36) });
  y -= 13;
  drawPdfMixedText(page, `Сценарий: ${scenarioLabel(report.scenarioId)}`, fonts, { x: 38, y, size: 8, color: rgb(0.25, 0.31, 0.36) });
  y -= 19;
  const metrics = [
    `Всего: ${report.summary.total}`, `Точные: ${report.summary.exact}`, `Вероятные: ${report.summary.likely}`,
    `Требуют проверки: ${report.summary.review}`, `Без совпадения: ${report.summary.noMatch}`, `Аналоги: ${report.summary.analogues}`,
    `Закупка: ${report.summary.procurement}`,
  ];
  drawPdfMixedText(page, metrics.join("   •   "), fonts, { x: 38, y, size: 8.5, color: rgb(0.18, 0.29, 0.31) });
  y -= 28;
  drawPdfMixedText(page, "Легенда статусов", fonts, { x: 38, y, size: 8.5, color: rgb(0.08, 0.34, 0.36) });
  y -= 13;
  drawPdfMixedText(page, "Точное совпадение · Вероятное совпадение · Требуется проверка", fonts, {
    x: 38,
    y,
    size: 7.2,
    color: rgb(0.3, 0.35, 0.4),
  });
  y -= 12;
  drawPdfMixedText(page, "Не найдено · Покрыто нормативно допустимыми аналогами · Недостаточное количество", fonts, {
    x: 38,
    y,
    size: 7.2,
    color: rgb(0.3, 0.35, 0.4),
  });
  y -= 20;
  let cursor: PdfCursor = { page, y };
  for (const [index, result] of report.results.entries()) {
    cursor = drawPdfResultCard(document, fonts, report, cursor, result, index);
  }
  cursor = drawPdfText(document, fonts, report, cursor, "Варианты аналогов", {
    size: 13,
    lineHeight: 18,
    color: rgb(0.08, 0.34, 0.36),
    marginTop: 10,
  });
  if (report.analogueOptions.length === 0) {
    cursor = drawPdfText(document, fonts, report, cursor, "Позиции для поиска аналогов отсутствуют.");
  }
  for (const analogue of report.analogueOptions) {
    cursor = drawPdfText(
      document,
      fonts,
      report,
      cursor,
      `${analogue.positionCode} · ${analogue.positionName}`,
      { size: 9.2, lineHeight: 13, color: rgb(0.08, 0.12, 0.16), marginTop: 8 },
    );
    cursor = drawPdfText(document, fonts, report, cursor, `Причина поиска: ${analogue.reason}`);
    cursor = drawPdfText(
      document,
      fonts,
      report,
      cursor,
      `Количество: требуется ${analogue.requiredQuantity} ${analogue.unit}; покрыто ${analogue.coveredQuantity} ${analogue.unit}; недостаток ${analogue.shortageQuantity} ${analogue.unit}.`,
    );
    cursor = drawPdfText(document, fonts, report, cursor, analogue.combinedCoverageLabel);
    if (analogue.plans.length === 0) {
      cursor = drawPdfText(document, fonts, report, cursor, "Основной и альтернативные планы покрытия не найдены.", {
        color: rgb(0.58, 0.18, 0.18),
      });
      continue;
    }
    for (const plan of analogue.plans) {
      cursor = drawPdfText(
        document,
        fonts,
        report,
        cursor,
        `${recommendationKindLabel(plan.kind)} · вариант ${plan.rank}`,
        { size: 8.4, lineHeight: 12, color: rgb(0.08, 0.34, 0.36), marginTop: 5 },
      );
      cursor = drawPdfText(
        document,
        fonts,
        report,
        cursor,
        `${plan.coverageLabel} Недостаток: ${plan.shortageQuantity} ${analogue.unit}.`,
      );
      if (plan.kind === "ALTERNATIVE") {
        cursor = drawPdfText(
          document,
          fonts,
          report,
          cursor,
          "Контрфактический вариант рассчитан по тому же снимку остатков и не изменяет резервирование основного плана.",
        );
      }
      for (const component of plan.components) {
        cursor = drawPdfText(
          document,
          fonts,
          report,
          cursor,
          `Компонент покрытия ${component.componentIndex}: ${component.materialCode} · ${component.materialName}`,
          { size: 8, lineHeight: 11, color: rgb(0.16, 0.29, 0.31), marginTop: 4, indent: 5 },
        );
        cursor = drawPdfText(
          document,
          fonts,
          report,
          cursor,
          `Соответствие ${component.score}% · вывод: ${analogueVerdictLabel(component.verdict)}.`,
          { indent: 5 },
        );
        cursor = drawPdfText(
          document,
          fonts,
          report,
          cursor,
          `Количество: доступно ${component.availableQuantity} ${component.unit}; выделено компоненту ${component.allocatedQuantity} ${component.unit}; остаток после расчётного распределения ${component.remainingAfterReservation} ${component.unit}.`,
          { indent: 5 },
        );
        cursor = drawPdfText(
          document,
          fonts,
          report,
          cursor,
          `Склад: ${component.plant} / ${component.warehouse}. Нормативное основание: ${component.citation.documentId}, точный пункт ${component.citation.clauseId}.`,
          { indent: 5 },
        );
        cursor = drawPdfText(document, fonts, report, cursor, component.explanation, { indent: 5 });
        cursor = drawPdfText(document, fonts, report, cursor, "Характеристики: Требуется / Доступно / Отклонение:", {
          size: 7.4,
          lineHeight: 10,
          color: rgb(0.25, 0.31, 0.36),
          indent: 5,
        });
        for (const deviation of component.deviations) {
          cursor = drawPdfText(
            document,
            fonts,
            report,
            cursor,
            `${deviation.characteristicLabel}: ${deviation.required} / ${deviation.available} / ${deviation.differs ? deviation.deviation : "Нет"}`,
            { size: 7.1, lineHeight: 9.5, indent: 13 },
          );
        }
      }
    }
  }
  cursor = drawPdfText(document, fonts, report, cursor, "Источники и версии", {
    size: 13,
    lineHeight: 18,
    color: rgb(0.08, 0.34, 0.36),
    marginTop: 12,
  });
  cursor = drawPdfText(document, fonts, report, cursor, `Appius PLM: ${String(report.provenance.appius ?? "—")}. Версии: ${provenanceAppiusVersions(report.provenance)}.`);
  cursor = drawPdfText(document, fonts, report, cursor, `SAP S/4HANA: ${String(report.provenance.sap ?? "—")}.`);
  cursor = drawPdfText(document, fonts, report, cursor, `Нормативное хранилище: ${String(report.provenance.normative ?? "—")}.`);
  cursor = drawPdfText(document, fonts, report, cursor, `Системный промпт: ${provenancePromptVersion(report.provenance)}.`);
  cursor = drawPdfText(document, fonts, report, cursor, `Правила ответственности: ${provenanceRuleVersions(report.provenance, "responsibilityRules")}.`);
  drawPdfText(document, fonts, report, cursor, `Правила аналогов: ${provenanceRuleVersions(report.provenance, "analogueRules")}.`);
  for (const [index, current] of document.getPages().entries()) {
    drawPdfMixedText(current, `${index + 1} / ${document.getPageCount()} · Только синтетические демо-данные`, fonts, { x: 38, y: 30, size: 7, color: rgb(0.42, 0.46, 0.5) });
  }
  return document.save();
}

export class ReportError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "ReportError"; }
}

function isReportView(value: unknown): value is ReportView {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const report = value as Partial<ReportView>;
  return typeof report.runId === "string" && Array.isArray(report.results) && Boolean(report.summary);
}

function isPositionAnalysisResult(value: unknown): value is PositionAnalysisResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Partial<PositionAnalysisResult>;
  return Boolean(result.position && result.match && result.status);
}

function summarizeCurrentResults(results: PositionAnalysisResult[]): ReportSummary {
  const category = (name: string) => results.filter((item) => item.match.category === name).length;
  const responsibility = summarizeResponsibilityDecisions(results);
  return {
    total: results.length,
    exact: category("EXACT"),
    found: results.filter((item) => item.status === "FOUND").length,
    likely: category("LIKELY"),
    review: category("REVIEW"),
    noMatch: category("NO_MATCH"),
    analogues: results.filter((item) => Boolean(item.analogueCoverage)).length,
    insufficient: results.filter((item) => item.status === "INSUFFICIENT").length,
    procurement: results.filter(
      (item) => item.status === "NOT_FOUND" || item.status === "INSUFFICIENT",
    ).length,
    customerResponsibility: responsibility.customer,
    contractorResponsibility: responsibility.contractor,
  };
}

function responsibilityState(
  result: Pick<PositionAnalysisResult, "responsibilityDecisionState" | "responsibility" | "responsibilityCitation" | "requiresHumanReview">,
): NonNullable<PositionAnalysisResult["responsibilityDecisionState"]> {
  return effectiveResponsibilityDecisionState(result);
}

function responsibilityDecisionLabel(result: PositionAnalysisResult): string {
  const state = responsibilityState(result);
  if (state === "INSUFFICIENT_DATA") return "Недостаточно данных";
  if (state === "REVIEW_REQUIRED" && result.responsibility === null) return "Требуется решение";
  const label = responsibilityLabel(result.responsibility);
  return state === "REVIEW_REQUIRED" ? `${label} · требуется проверка` : label;
}

function responsibilityCitationLabel(result: PositionAnalysisResult): string {
  return result.responsibilityCitation
    ? `${result.responsibilityCitation.documentId}, ${result.responsibilityCitation.clauseId}`
    : "Нормативное основание не найдено";
}

interface PdfFonts {
  cyrillic: PDFFont;
  latin: PDFFont;
}

function addPage(document: PDFDocument, fonts: PdfFonts, report: ReportView, compact = false): PDFPage {
  const page = document.addPage([595.28, 841.89]);
  drawPdfMixedText(page, compact ? "Отчёт анализа МТР · продолжение" : "Итоговый отчёт анализа МТР", fonts, { x: 38, y: 800, size: compact ? 13 : 17, color: rgb(0.08, 0.34, 0.36) });
  drawPdfMixedText(page, `Запуск ${report.runId} · ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Moscow" }).format(new Date(report.generatedAt))}`, fonts, { x: 38, y: 782, size: 8, color: rgb(0.35, 0.39, 0.43) });
  return page;
}

interface PdfCursor {
  page: PDFPage;
  y: number;
}

interface PdfTextOptions {
  size?: number;
  lineHeight?: number;
  color?: ReturnType<typeof rgb>;
  marginTop?: number;
  indent?: number;
}

function drawPdfResultCard(
  document: PDFDocument,
  fonts: PdfFonts,
  report: ReportView,
  cursor: PdfCursor,
  result: PositionAnalysisResult,
  index: number,
): PdfCursor {
  const material = result.match.material?.materialCode ?? "нет прямого совпадения";
  const coverage = result.analogueCoverage
    ? ` · аналоги ${result.analogueCoverage.coveredQuantity}/${result.analogueCoverage.requiredQuantity} ${result.analogueCoverage.unit}`
    : "";
  const reviewed = result.manualResponsibilityOverrides?.length ? " · решение эксперта" : "";
  const explanation = result.responsibilityExplanation ? ` · ${result.responsibilityExplanation}` : "";
  const explanationText = `${analysisStatusLabel(result.status)} · ${responsibilityDecisionLabel(result)} · ${responsibilityCitationLabel(result)}${reviewed}${explanation}`;
  const explanationLines = wrapPdfText(explanationText, fonts, 7.2, 515);
  const cardHeight = 45 + Math.max(0, explanationLines.length - 1) * 9.5;
  let page = cursor.page;
  let top = cursor.y;
  if (top - cardHeight < 48) {
    page = addPage(document, fonts, report, true);
    top = 748;
  }
  page.drawRectangle({
    x: 34,
    y: top - cardHeight,
    width: 527,
    height: cardHeight,
    color: index % 2 ? rgb(0.97, 0.98, 0.98) : rgb(1, 1, 1),
    borderColor: rgb(0.87, 0.9, 0.9),
    borderWidth: 0.5,
  });
  drawPdfMixedText(page, `${result.position.internalCode} · ${result.position.nameRu}`, fonts, {
    x: 40,
    y: top - 11,
    size: 8.2,
    color: rgb(0.08, 0.12, 0.16),
  });
  drawPdfMixedText(page, `${matchCategoryLabel(result.match.category)} · соответствие ${result.match.score}% · SAP: ${material}${coverage}`, fonts, {
    x: 40,
    y: top - 24,
    size: 7.4,
    color: rgb(0.25, 0.31, 0.36),
  });
  for (const [lineIndex, line] of explanationLines.entries()) {
    drawPdfMixedText(page, line, fonts, {
      x: 40,
      y: top - 37 - lineIndex * 9.5,
      size: 7.2,
      color: rgb(0.25, 0.31, 0.36),
    });
  }
  return { page, y: top - cardHeight - 6 };
}

function drawPdfText(
  document: PDFDocument,
  fonts: PdfFonts,
  report: ReportView,
  cursor: PdfCursor,
  text: string,
  options: PdfTextOptions = {},
): PdfCursor {
  const size = options.size ?? 7.3;
  const lineHeight = options.lineHeight ?? 10;
  const indent = options.indent ?? 0;
  let page = cursor.page;
  let y = cursor.y - (options.marginTop ?? 0);
  for (const line of wrapPdfText(text, fonts, size, 519 - indent)) {
    if (y < 48 + lineHeight) {
      page = addPage(document, fonts, report, true);
      y = 748;
    }
    drawPdfMixedText(page, line, fonts, {
      x: 38 + indent,
      y,
      size,
      color: options.color ?? rgb(0.25, 0.31, 0.36),
    });
    y -= lineHeight;
  }
  return { page, y };
}

function wrapPdfText(text: string, fonts: PdfFonts, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/u).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = words[0] ?? "";
    for (const word of words.slice(1)) {
      const candidate = `${line} ${word}`;
      if (pdfMixedTextWidth(candidate, fonts, size) <= maxWidth) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawPdfMixedText(
  page: PDFPage,
  text: string,
  fonts: PdfFonts,
  options: { x: number; y: number; size: number; color: ReturnType<typeof rgb> },
): void {
  let x = options.x;
  for (const segment of pdfTextSegments(text)) {
    const font = segment.script === "CYRILLIC" ? fonts.cyrillic : fonts.latin;
    page.drawText(segment.text, { ...options, x, font });
    x += font.widthOfTextAtSize(segment.text, options.size);
  }
}

function pdfMixedTextWidth(text: string, fonts: PdfFonts, size: number): number {
  return pdfTextSegments(text).reduce((width, segment) => {
    const font = segment.script === "CYRILLIC" ? fonts.cyrillic : fonts.latin;
    return width + font.widthOfTextAtSize(segment.text, size);
  }, 0);
}

export function pdfTextSegments(text: string): Array<{ script: "CYRILLIC" | "LATIN"; text: string }> {
  const segments: Array<{ script: "CYRILLIC" | "LATIN"; text: string }> = [];
  for (const character of text) {
    const script = /[\u0400-\u052f]/u.test(character) ? "CYRILLIC" : "LATIN";
    const previous = segments.at(-1);
    if (previous?.script === script) previous.text += character;
    else segments.push({ script, text: character });
  }
  return segments;
}

export function createLocalizedReportExport(report: ReportView): unknown {
  return localizeJsonValue(report);
}

function localizeJsonValue(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    if (key === "category" && Object.hasOwn(ENUM_LABELS.matchCategory, value)) {
      return matchCategoryLabel(value as keyof typeof ENUM_LABELS.matchCategory);
    }
    if (key === "verdict" && Object.hasOwn(ENUM_LABELS.analogueVerdict, value)) {
      return analogueVerdictLabel(value as keyof typeof ENUM_LABELS.analogueVerdict);
    }
    if (key === "characteristic") return characteristicLabel(value);
    if (key === "matched" || key === "differences") return localizeKnownEnumsInText(value);
    return localizeKnownEnum(value);
  }
  if (Array.isArray(value)) return value.map((item) => localizeJsonValue(item, key));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      localizeJsonValue(entryValue, entryKey),
    ]),
  );
}

function provenancePromptVersion(provenance: Record<string, unknown>): string {
  const prompt = provenance.prompt;
  if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)) return "—";
  const value = (prompt as Record<string, unknown>).version;
  return typeof value === "string" ? value : "—";
}

function provenanceAppiusVersions(provenance: Record<string, unknown>): string {
  const versions = provenance.appiusVersions;
  if (!Array.isArray(versions) || versions.length === 0) return "—";
  return versions
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const value = entry as Record<string, unknown>;
      const versionId = typeof value.versionId === "string" ? value.versionId : "";
      const versionNumber = typeof value.versionNumber === "number" ? value.versionNumber : null;
      return versionId ? [`${versionId}${versionNumber === null ? "" : ` (v${versionNumber})`}`] : [];
    })
    .join("; ") || "—";
}

function formatReportGeneratedAt(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}

function provenanceRuleVersions(
  provenance: Record<string, unknown>,
  key: "responsibilityRules" | "analogueRules",
): string {
  const rules = provenance[key];
  if (!Array.isArray(rules) || rules.length === 0) return "—";
  return rules
    .flatMap((rule) => {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) return [];
      const value = rule as Record<string, unknown>;
      const documentId = typeof value.documentId === "string" ? value.documentId : "";
      const version = typeof value.version === "string" ? value.version : "";
      const clauseId = typeof value.clauseId === "string" ? value.clauseId : "";
      return documentId && version ? [`${documentId}@${version}${clauseId ? `#${clauseId}` : ""}`] : [];
    })
    .join("; ") || "—";
}

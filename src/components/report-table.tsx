"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ManualResponsibilityReview } from "@/components/manual-responsibility-review";
import type { MatchCategory, PositionAnalysisResult, ReportSummary } from "@/domain/models";
import { formatNumber } from "@/lib/format";
import {
  analysisStatusLabel,
  analogueVerdictLabel,
  characteristicLabel,
  matchCategoryLabel,
  recommendationKindLabel,
  responsibilityLabel,
} from "@/lib/localization";
import type {
  AnalogueComponentView,
  AnaloguePlanView,
  PositionAnalogueView,
} from "@/lib/report-analogues";

interface ReportTableProps {
  runId: string;
  summary: ReportSummary;
  results: PositionAnalysisResult[];
  analogueOptions: PositionAnalogueView[];
  provenance: Record<string, unknown>;
}

export function ReportTable({
  runId,
  summary,
  results,
  analogueOptions,
  provenance,
}: ReportTableProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"ALL" | MatchCategory>("ALL");
  const [sort, setSort] = useState<"CODE" | "SCORE">("CODE");
  const [selected, setSelected] = useState<PositionAnalysisResult | null>(null);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    return results
      .filter((result) => {
        const text = `${result.position.internalCode} ${result.position.nameRu} ${result.match.material?.materialCode ?? ""}`
          .toLocaleLowerCase("ru-RU");
        return (!normalized || text.includes(normalized))
          && (category === "ALL" || result.match.category === category);
      })
      .toSorted((left, right) => sort === "SCORE"
        ? right.match.score - left.match.score
        : left.position.internalCode.localeCompare(right.position.internalCode, "ru"));
  }, [category, query, results, sort]);

  return (
    <>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <Metric label="Всего" value={summary.total} />
        <Metric label="Точные" value={summary.exact} />
        <Metric label="Вероятные" value={summary.likely} />
        <Metric label="Требуют проверки" value={summary.review} />
        <Metric label="Не найдено" value={summary.noMatch} />
        <Metric label="Аналоги" value={summary.analogues} />
        <Metric label="Закупка" value={summary.procurement} warning />
      </div>

      <section
        aria-label="Версии источников"
        className="mb-5 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 sm:grid-cols-2 xl:grid-cols-4"
      >
        <SourceVersion label="Снимок Appius PLM" value={provenanceText(provenance.appius)} />
        <SourceVersion label="Снимок SAP S/4HANA" value={provenanceText(provenance.sap)} />
        <SourceVersion label="Системный промпт" value={promptVersion(provenance.prompt)} />
        <SourceVersion
          label="Правила"
          value={`${arrayLength(provenance.responsibilityRules)} ответственности · ${arrayLength(provenance.analogueRules)} аналогов`}
        />
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid flex-1 gap-3 sm:grid-cols-3">
            <label className="text-xs font-medium text-slate-600">
              Поиск
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Код, название, SAP…"
                className="focus-ring mt-1 h-9 w-full rounded-md border border-slate-300 px-3 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Категория
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as "ALL" | MatchCategory)}
                className="focus-ring mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="ALL">Все</option>
                <option value="EXACT">{matchCategoryLabel("EXACT")}</option>
                <option value="LIKELY">{matchCategoryLabel("LIKELY")}</option>
                <option value="REVIEW">{matchCategoryLabel("REVIEW")}</option>
                <option value="NO_MATCH">{matchCategoryLabel("NO_MATCH")}</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Сортировка
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as "CODE" | "SCORE")}
                className="focus-ring mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="CODE">По коду</option>
                <option value="SCORE">По проценту соответствия</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <ExportLink runId={runId} format="json" label="JSON" />
            <ExportLink runId={runId} format="xlsx" label="Excel" />
            <ExportLink runId={runId} format="pdf" label="PDF" />
          </div>
        </div>
        <div className="data-table-scroll overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="z-10 bg-slate-50 px-4 py-3 xl:sticky xl:left-0">Позиция</th>
                <th className="px-4 py-3">Количество</th>
                <th className="px-4 py-3">Ответственность</th>
                <th className="px-4 py-3">Совпадение</th>
                <th className="px-4 py-3">SAP / остаток</th>
                <th className="px-4 py-3">Аналоги</th>
                <th className="px-4 py-3">Итог</th>
                <th className="px-4 py-3"><span className="sr-only">Действия</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((result) => (
                <tr key={result.position.id} className="hover:bg-slate-50">
                  <td className="max-w-[290px] bg-white px-4 py-3 align-top xl:sticky xl:left-0">
                    <p className="font-mono text-[11px] font-semibold text-teal-800">{result.position.internalCode}</p>
                    <p className="mt-1 font-medium leading-5">{result.position.nameRu}</p>
                  </td>
                  <td className="px-4 py-3 align-top tabular-nums">
                    {formatNumber(result.position.requiredQuantity)} {result.position.unit}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {responsibilityResultLabel(result)}
                    <p className="mt-1 text-xs text-slate-500">
                      {result.responsibilityConfidence === null
                        ? "Уверенность не рассчитана"
                        : `${Math.round(result.responsibilityConfidence * 100)}%`}
                    </p>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <Category value={result.match.category} />
                    <p className="mt-1 text-xs text-slate-500">Соответствие {result.match.score}%</p>
                  </td>
                  <td className="px-4 py-3 align-top">
                    {result.match.material ? (
                      <>
                        <Link
                          href={`/materials/${result.match.material.materialCode}`}
                          className="font-mono text-xs font-semibold text-teal-800 hover:underline"
                        >
                          {result.match.material.materialCode}
                        </Link>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatNumber(result.match.material.availableQuantity)} {result.match.material.unit}
                        </p>
                      </>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {result.analogueCoverage
                      ? `${formatNumber(result.analogueCoverage.coveredQuantity)} / ${formatNumber(result.analogueCoverage.requiredQuantity)} ${result.analogueCoverage.unit}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className="font-medium">{analysisStatusLabel(result.status)}</span>
                    {result.requiresHumanReview
                      ? <p className="mt-1 text-xs text-amber-700">Нужна экспертная проверка</p>
                      : null}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <button
                      type="button"
                      onClick={() => setSelected(result)}
                      className="focus-ring rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50"
                    >
                      Подробнее
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    По заданным условиям позиций нет.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <AnalogueOptionsSection positions={analogueOptions} />
      {selected
        ? <DetailsDrawer runId={runId} result={selected} onClose={() => setSelected(null)} />
        : null}
    </>
  );
}

function AnalogueOptionsSection({ positions }: { positions: PositionAnalogueView[] }) {
  return (
    <section aria-labelledby="analogue-options-title" className="mt-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Нормативно подтверждённый подбор</p>
        <h2 id="analogue-options-title" className="mt-1 text-xl font-semibold text-slate-950">Варианты аналогов</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Основной и альтернативные планы состоят только из нормативно допустимых материалов. Компоненты покрытия, отклонения и недостаток количества показаны явно.
        </p>
      </div>
      {positions.length === 0 ? (
        <p className="mt-5 rounded-md bg-slate-50 p-4 text-sm text-slate-600">
          Позиции для поиска аналогов отсутствуют.
        </p>
      ) : (
        <div className="mt-5 space-y-5">
          {positions.map((position) => <PositionAnalogueCard key={position.positionId} position={position} />)}
        </div>
      )}
    </section>
  );
}

function PositionAnalogueCard({ position }: { position: PositionAnalogueView }) {
  return (
    <article className="overflow-hidden rounded-lg border border-slate-200" data-testid="analogue-position">
      <header className="border-b border-slate-200 bg-slate-50 p-4">
        <p className="font-mono text-xs font-semibold text-teal-800">{position.positionCode}</p>
        <h3 className="mt-1 font-semibold text-slate-950">{position.positionName}</h3>
        <p className="mt-2 text-sm text-slate-600"><span className="font-medium text-slate-800">Причина поиска:</span> {position.reason}</p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
          <span>Требуется: <strong className="text-slate-900">{formatNumber(position.requiredQuantity)} {position.unit}</strong></span>
          <span>Покрыто: <strong className="text-slate-900">{formatNumber(position.coveredQuantity)} {position.unit}</strong></span>
          <span className={position.shortageQuantity > 0 ? "font-semibold text-rose-700" : "text-emerald-700"}>
            Недостаток: {formatNumber(position.shortageQuantity)} {position.unit}
          </span>
        </div>
        <p className="mt-2 text-xs text-slate-500">{position.combinedCoverageLabel}</p>
      </header>
      {position.plans.length === 0 ? (
        <p className="p-4 text-sm text-rose-700">Основной и альтернативные планы покрытия не найдены.</p>
      ) : (
        <div className="divide-y divide-slate-200">
          {position.plans.map((plan) => (
            <AnaloguePlanCard key={`${plan.kind}-${plan.rank}`} plan={plan} unit={position.unit} />
          ))}
        </div>
      )}
    </article>
  );
}

function AnaloguePlanCard({ plan, unit }: { plan: AnaloguePlanView; unit: string }) {
  return (
    <section className="p-4" data-testid="analogue-plan">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">
            {recommendationKindLabel(plan.kind)} · вариант {plan.rank}
          </p>
          <p className="mt-1 text-sm text-slate-700">{plan.coverageLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          <span className={plan.complete ? "text-emerald-700" : "text-rose-700"}>
            Покрыто {formatNumber(plan.coveredQuantity)} из {formatNumber(plan.coveredQuantity + plan.shortageQuantity)} {unit}
          </span>
        </div>
      </div>
      {plan.kind === "ALTERNATIVE" ? (
        <p className="mt-2 text-xs text-slate-500">
          Контрфактический вариант рассчитан по тому же снимку остатков и не изменяет резервирование основного плана.
        </p>
      ) : null}
      <div className="mt-3 space-y-3">
        {plan.components.map((component) => (
          <AnalogueComponentCard
            key={`${component.materialCode}-${component.componentIndex}`}
            component={component}
            combinedCoverage={plan.combinedCoverage}
          />
        ))}
      </div>
    </section>
  );
}

function AnalogueComponentCard({
  component,
  combinedCoverage,
}: {
  component: AnalogueComponentView;
  combinedCoverage: boolean;
}) {
  return (
    <article className="rounded-md border border-slate-200 p-4" data-testid="analogue-option">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Компонент покрытия {component.componentIndex}
          </p>
          <h4 className="mt-1 font-semibold text-slate-950">
            <Link href={`/materials/${component.materialCode}`} className="font-mono text-teal-800 hover:underline">
              {component.materialCode}
            </Link>
            <span className="font-normal"> · {component.materialName}</span>
          </h4>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">Соответствие {component.score}%</span>
          <Verdict value={component.verdict} />
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2 xl:grid-cols-4">
        <Fact label="Требуется плану" value={`${formatNumber(component.requiredQuantity)} ${component.unit}`} />
        <Fact label="Доступно у компонента" value={`${formatNumber(component.availableQuantity)} ${component.unit}`} />
        <Fact label="Выделено компоненту" value={`${formatNumber(component.allocatedQuantity)} ${component.unit}`} />
        <Fact label="Остаток после расчётного распределения" value={`${formatNumber(component.remainingAfterReservation)} ${component.unit}`} />
        <Fact label="Склад" value={`${component.plant} / ${component.warehouse}`} />
        <Fact label="Покрытие" value={combinedCoverage ? "Совместно с другими материалами" : "Одним материалом"} />
        <Fact label="Нормативное основание" value={component.citation.documentId} />
        <Fact label="Точный пункт правила" value={component.citation.clauseId} />
      </div>

      <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-700">{component.explanation}</p>
      <div className="data-table-scroll mt-3 overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full min-w-[640px] text-left text-xs">
          <caption className="sr-only">Требуемые и доступные характеристики аналога</caption>
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2">Характеристика</th>
              <th className="px-3 py-2">Требуется</th>
              <th className="px-3 py-2">Доступно</th>
              <th className="px-3 py-2">Отклонение</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {component.deviations.map((deviation) => (
              <tr key={deviation.characteristic} className={deviation.differs ? "bg-amber-50/70" : undefined}>
                <td className="px-3 py-2 font-medium text-slate-800">{deviation.characteristicLabel}</td>
                <td className="px-3 py-2 text-slate-700">{deviation.required}</td>
                <td className="px-3 py-2 text-slate-700">{deviation.available}</td>
                <td className={`px-3 py-2 ${deviation.differs ? "font-semibold text-amber-800" : "text-emerald-700"}`}>
                  {deviation.differs ? capitalize(deviation.deviation) : "Нет"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function DetailsDrawer({
  runId,
  result,
  onClose,
}: {
  runId: string;
  result: PositionAnalysisResult;
  onClose: () => void;
}) {
  const primaryAllocations = result.analogueCoverage?.primaryPlan?.allocations
    ?? result.analogueCoverage?.allocations
    ?? [];
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/25"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        className="h-full w-full max-w-lg overflow-y-auto bg-white p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-semibold text-teal-800">{result.position.internalCode}</p>
            <h2 id="detail-title" className="mt-1 text-xl font-semibold">Объяснение результата</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть подробности"
            className="focus-ring rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          >
            Закрыть
          </button>
        </div>
        <div className="mt-6 space-y-5 text-sm">
          <Block title="Позиция">
            <p>{result.position.nameRu}</p>
            <p className="mt-1 text-slate-500">
              {formatNumber(result.position.requiredQuantity)} {result.position.unit} · версия {result.position.versionNumber}
            </p>
          </Block>
          <Block title="Совпавшие признаки">
            {result.match.matched.length
              ? <ul className="list-disc space-y-1 pl-5">{result.match.matched.map((item) => <li key={item}>{item}</li>)}</ul>
              : <p>Нет</p>}
          </Block>
          <Block title="Различия">
            {result.match.differences.length
              ? <ul className="list-disc space-y-1 pl-5">{result.match.differences.map((item) => <li key={item}>{item}</li>)}</ul>
              : <p>Различий не выявлено.</p>}
          </Block>
          <Block title="Нормативное основание">
            <p>{result.responsibilityCitation?.title ?? "Нормативное основание не найдено"}</p>
            {result.responsibilityExplanation ? (
              <p className="mt-1 text-slate-600">Обоснование: {result.responsibilityExplanation}</p>
            ) : null}
            {result.responsibilityCitation ? (
              <p className="mt-1 font-mono text-xs text-slate-500">
                {result.responsibilityCitation.documentId} · {result.responsibilityCitation.version} · {result.responsibilityCitation.clauseId}
              </p>
            ) : null}
          </Block>
          {result.analogueCoverage ? (
            <Block title="Компоненты основного плана покрытия">
              <div className="space-y-2">
                {primaryAllocations.map((allocation) => (
                  <div key={allocation.material.id} className="rounded-md border border-slate-200 p-3">
                    <p className="font-mono text-xs font-semibold">{allocation.material.materialCode}</p>
                    <p className="mt-1">
                      Выделено {formatNumber(allocation.allocatedQuantity)} {result.analogueCoverage?.unit} · {analogueVerdictLabel(allocation.verdict)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Правило {allocation.citation.documentId}, пункт {allocation.citation.clauseId}
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-slate-600">
                      {allocation.deviations.map((deviation) => (
                        <li key={deviation.characteristic}>
                          {characteristicLabel(deviation.characteristic)}: {deviation.required} → {deviation.available} → {deviation.deviation === "нет" ? "Нет" : capitalize(deviation.deviation)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              {(result.analogueCoverage.alternativePlans?.length ?? 0) > 0 ? (
                <p className="mt-2 text-xs text-slate-500">
                  Альтернативных контрфактических планов: {result.analogueCoverage.alternativePlans?.length}.
                </p>
              ) : null}
            </Block>
          ) : null}
          <ManualResponsibilityReview runId={runId} result={result} />
        </div>
      </aside>
    </div>
  );
}

function Metric({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 shadow-sm ${warning ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function SourceVersion({ label, value }: { label: string; value: string }) {
  return <div><p className="font-semibold text-slate-800">{label}</p><p className="mt-1 break-words font-mono text-[11px]">{value}</p></div>;
}

function Category({ value }: { value: MatchCategory }) {
  const tone = value === "EXACT"
    ? "bg-emerald-50 text-emerald-800"
    : value === "LIKELY"
      ? "bg-blue-50 text-blue-800"
      : value === "REVIEW"
        ? "bg-amber-50 text-amber-800"
        : "bg-rose-50 text-rose-800";
  return <span className={`rounded-full px-2 py-1 text-xs font-semibold ${tone}`}>{matchCategoryLabel(value)}</span>;
}

function Verdict({ value }: { value: AnalogueComponentView["verdict"] }) {
  const tone = value === "SUITABLE"
    ? "bg-emerald-50 text-emerald-800"
    : value === "REVIEW"
      ? "bg-amber-50 text-amber-800"
      : "bg-rose-50 text-rose-800";
  return <span className={`rounded-full px-2.5 py-1 font-semibold ${tone}`}>{analogueVerdictLabel(value)}</span>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md bg-slate-50 p-2.5"><p className="text-slate-500">{label}</p><p className="mt-1 break-words font-medium text-slate-800">{value}</p></div>;
}

function ExportLink({ runId, format, label }: { runId: string; format: string; label: string }) {
  return (
    <a
      href={`/api/reports/${encodeURIComponent(runId)}/export?format=${format}`}
      className="focus-ring rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold hover:bg-slate-50"
    >
      {label}
    </a>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3><div className="leading-6 text-slate-700">{children}</div></section>;
}

function responsibilityResultLabel(result: PositionAnalysisResult): string {
  if (result.responsibilityDecisionState === "INSUFFICIENT_DATA" || result.responsibility === null) {
    return "Недостаточно данных";
  }
  const label = responsibilityLabel(result.responsibility);
  return result.responsibilityDecisionState === "REVIEW_REQUIRED"
    ? `${label} · требуется проверка`
    : label;
}

function provenanceText(value: unknown): string {
  return typeof value === "string" && value ? value : "—";
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function promptVersion(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "—";
  const version = (value as Record<string, unknown>).version;
  return typeof version === "string" && version ? version : "—";
}

function capitalize(value: string): string {
  return value.length > 0 ? `${value[0]?.toLocaleUpperCase("ru-RU")}${value.slice(1)}` : value;
}

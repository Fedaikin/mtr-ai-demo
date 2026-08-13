import Link from "next/link";
import type { ReactNode } from "react";

import {
  ANALYTICS_CATEGORIES,
  ANALYTICS_DEPARTMENTS,
  ANALYTICS_PERIODS,
  ANALYTICS_PROCESSES,
  ANALYTICS_WAREHOUSES,
  type AnalyticsAccessProfile,
  type AnalyticsFilters,
} from "@/domain/general-analytics";
import { formatNumber } from "@/lib/format";

interface Snapshot {
  stock: number; consumption: number; processedPositions: number; runs: number; completed: number; failed: number; sla: number; forecastShortage: number;
  series: Array<{ label: string; inventory: number; consumption: number }>;
  stages: Array<{ label: string; value: number }>;
}
interface NomenclatureRow { code: string; name: string; category: string; quantity: number; trend: number }

export function GeneralAnalyticsDashboard({ access, filters, snapshot, nomenclature, freshness }: { access: AnalyticsAccessProfile; filters: AnalyticsFilters; snapshot: Snapshot; nomenclature: NomenclatureRow[]; freshness: string }) {
  return <>
    <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Фильтры общей аналитики">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Охват по RBAC</p><p className="mt-1 text-sm font-semibold text-slate-950">{access.scopeLabel}</p><p className="mt-1 text-xs text-slate-500">{access.detailLabel}</p></div><span className="rounded-full bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800">Срез на {freshness}</span></div>
      <form className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <FilterSelect name="period" label="Период" value={String(filters.period)} options={ANALYTICS_PERIODS.map((value) => [String(value), `${value} дней`])} />
        <FilterSelect name="warehouse" label="Склад" value={filters.warehouse} disabled={!access.canFilterWarehouse} options={ANALYTICS_WAREHOUSES.map((value) => [value, warehouseLabel(value)])} />
        <FilterSelect name="department" label="Подразделение" value={filters.department} disabled={!access.canFilterDepartment} options={ANALYTICS_DEPARTMENTS.map((value) => [value, departmentLabel(value)])} />
        <FilterSelect name="process" label="Процесс" value={filters.process} options={ANALYTICS_PROCESSES.map((value) => [value, processLabel(value)])} />
        <FilterSelect name="category" label="Номенклатура" value={filters.category} options={ANALYTICS_CATEGORIES.map((value) => [value, categoryLabel(value)])} />
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 xl:col-span-5"><button className="focus-ring rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800">Применить</button><Link href="/analytics" className="focus-ring rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Сбросить</Link>{!access.canFilterWarehouse ? <span className="text-xs text-slate-500">Точные склады скрыты: показан разрешённый агрегированный уровень.</span> : null}</div>
      </form>
    </section>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <Metric label="Текущий запас" value={formatNumber(snapshot.stock)} hint="ед. в выбранном срезе" />
      <Metric label="Расход за период" value={formatNumber(snapshot.consumption)} hint={`${filters.period} дней`} />
      <Metric label="Обработано позиций" value={formatNumber(snapshot.processedPositions)} hint="в спецификациях" />
      <Metric label="Загрузка процесса" value={`${Math.min(98, 64 + snapshot.runs)}%`} hint={`${snapshot.runs} запусков`} tone="warning" />
      <Metric label="SLA" value={`${snapshot.sla}%`} hint="цель ≥ 95%" tone={snapshot.sla >= 95 ? "success" : "danger"} />
      <Metric label="Прогноз дефицита" value={formatNumber(snapshot.forecastShortage)} hint="ед. на горизонте" tone={snapshot.forecastShortage > 0 ? "danger" : "success"} />
    </div>
    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.45fr)]">
      <DashboardCard eyebrow="Запасы и расход" title="Динамика за выбранный период"><TrendChart points={snapshot.series} /></DashboardCard>
      <DashboardCard eyebrow="Прогноз" title="Ожидаемое состояние"><div className="rounded-lg bg-slate-950 p-4 text-white"><p className="text-xs text-slate-300">Расчётный остаток</p><p className="mt-1 text-3xl font-semibold tabular-nums">{formatNumber(Math.max(0, snapshot.stock - snapshot.consumption))}</p><p className="mt-1 text-xs text-slate-400">после ожидаемого расхода</p></div><div className="mt-3 space-y-3"><ForecastLine label="Риск дефицита" value={snapshot.forecastShortage > 0 ? "Высокий" : "Низкий"} warning={snapshot.forecastShortage > 0} /><ForecastLine label="Доверие прогноза" value="Среднее · 8 срезов" /><ForecastLine label="Следующий пересчёт" value="После синхронизации SAP" /></div><p className="mt-4 text-xs leading-5 text-slate-500">Прогноз аналитический и не создаёт закупку или резерв автоматически.</p></DashboardCard>
    </div>
    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <DashboardCard eyebrow="Спецификации" title="Воронка обработки"><StageChart stages={snapshot.stages} /><div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs"><SmallFact label="Завершено" value={snapshot.completed} /><SmallFact label="В работе" value={Math.max(0, snapshot.runs - snapshot.completed - snapshot.failed)} /><SmallFact label="Ошибки" value={snapshot.failed} danger={snapshot.failed > 0} /></div></DashboardCard>
      <DashboardCard eyebrow="Загрузка" title={access.canSeeTeamBreakdown ? "Подразделения и процессы" : "Процессы в доступном контуре"}><UtilizationBars team={access.canSeeTeamBreakdown} /></DashboardCard>
    </div>
    <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-5"><div><p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Номенклатура</p><h2 className="mt-1 text-lg font-semibold">{access.canSeeExactNomenclature ? "Позиции, требующие внимания" : "Агрегированный вклад категорий"}</h2></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{access.canSeeExactNomenclature ? "Коды доступны" : "Без кодов и складских количеств"}</span></div><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-5 py-3">{access.canSeeExactNomenclature ? "Код" : "Группа"}</th><th className="px-5 py-3">Наименование</th><th className="px-5 py-3">Категория</th><th className="px-5 py-3 text-right">{access.canSeeExactNomenclature ? "Остаток" : "Индекс"}</th><th className="px-5 py-3 text-right">Динамика</th></tr></thead><tbody className="divide-y divide-slate-100">{nomenclature.map((row) => <tr key={row.code}><td className="px-5 py-3 font-mono text-xs font-semibold text-teal-800">{row.code}</td><td className="px-5 py-3 font-medium">{row.name}</td><td className="px-5 py-3 text-slate-500">{categoryLabel(row.category)}</td><td className="px-5 py-3 text-right tabular-nums">{formatNumber(row.quantity)}</td><td className={`px-5 py-3 text-right font-semibold tabular-nums ${row.trend < 0 ? "text-red-700" : "text-emerald-700"}`}>{row.trend > 0 ? "+" : ""}{row.trend}%</td></tr>)}</tbody></table></div></section>
  </>;
}

function TrendChart({ points }: { points: Snapshot["series"] }) {
  const width = 760, height = 245, padding = 30, maximum = Math.max(1, ...points.flatMap((point) => [point.inventory, point.consumption]));
  const path = (key: "inventory" | "consumption") => points.map((point, index) => `${index === 0 ? "M" : "L"}${padding + index * ((width - padding * 2) / Math.max(1, points.length - 1))},${height - padding - point[key] / maximum * (height - padding * 2)}`).join(" ");
  return <div><div className="mb-3 flex flex-wrap gap-4 text-xs"><Legend color="bg-teal-600" label="Запас" /><Legend color="bg-amber-500" label="Накопленный расход" /></div><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="График динамики запасов и расхода" className="h-auto w-full"><g stroke="#e2e8f0" strokeWidth="1">{[0, 1, 2, 3, 4].map((index) => <line key={index} x1={padding} y1={padding + index * ((height - padding * 2) / 4)} x2={width - padding} y2={padding + index * ((height - padding * 2) / 4)} />)}</g><path d={path("inventory")} fill="none" stroke="#0f766e" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /><path d={path("consumption")} fill="none" stroke="#f59e0b" strokeWidth="3" strokeDasharray="7 6" strokeLinecap="round" strokeLinejoin="round" />{points.map((point, index) => <text key={point.label} x={padding + index * ((width - padding * 2) / Math.max(1, points.length - 1))} y={height - 6} textAnchor="middle" className="fill-slate-500 text-[10px]">{point.label}</text>)}</svg></div>;
}

function StageChart({ stages }: { stages: Snapshot["stages"] }) { const maximum = Math.max(1, ...stages.map((stage) => stage.value)); return <div className="space-y-3">{stages.map((stage, index) => <div key={stage.label}><div className="flex justify-between text-xs"><span className="font-medium text-slate-700">{stage.label}</span><span className="tabular-nums text-slate-500">{formatNumber(stage.value)}</span></div><div className="mt-1.5 h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-teal-600" style={{ width: `${Math.max(8, stage.value / maximum * 100 - index * 2)}%`, opacity: 1 - index * 0.13 }} /></div></div>)}</div>; }
function UtilizationBars({ team }: { team: boolean }) { const rows = team ? [["Проектный офис", 88], ["Закупки", 82], ["МТО и склад", 71], ["Инжиниринг", 64]] as const : [["Проверка спецификаций", 86], ["Анализ МТР", 78], ["Экспертная проверка", 69], ["Формирование отчёта", 55]] as const; return <div className="space-y-4">{rows.map(([label, value]) => <div key={label}><div className="flex justify-between text-sm"><span className="font-medium">{label}</span><span className="font-semibold tabular-nums">{value}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${value >= 85 ? "bg-red-500" : value >= 75 ? "bg-amber-500" : "bg-teal-600"}`} style={{ width: `${value}%` }} /></div></div>)}</div>; }
function FilterSelect({ name, label, value, options, disabled = false }: { name: string; label: string; value: string; options: Array<readonly [string, string]>; disabled?: boolean }) { return <label className="text-xs font-medium text-slate-600">{label}<select name={name} defaultValue={value} disabled={disabled} className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500">{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select>{disabled ? <input type="hidden" name={name} value={value} /> : null}</label>; }
function Metric({ label, value, hint, tone = "default" }: { label: string; value: string; hint: string; tone?: "default" | "success" | "warning" | "danger" }) { const style = { default: "border-slate-200 bg-white", success: "border-emerald-200 bg-emerald-50/70", warning: "border-amber-200 bg-amber-50/70", danger: "border-red-200 bg-red-50/70" }[tone]; return <div className={`rounded-lg border p-4 shadow-sm ${style}`}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-[11px] text-slate-500">{hint}</p></div>; }
function DashboardCard({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) { return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-teal-700">{eyebrow}</p><h2 className="mt-1 text-lg font-semibold">{title}</h2><div className="mt-4">{children}</div></section>; }
function ForecastLine({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) { return <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3 text-sm last:border-0"><span className="text-slate-500">{label}</span><span className={warning ? "font-semibold text-red-700" : "font-semibold text-slate-900"}>{value}</span></div>; }
function SmallFact({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) { return <div className="rounded-md bg-slate-50 p-2"><p className="text-slate-500">{label}</p><p className={`mt-1 text-base font-semibold tabular-nums ${danger ? "text-red-700" : "text-slate-900"}`}>{value}</p></div>; }
function Legend({ color, label }: { color: string; label: string }) { return <span className="inline-flex items-center gap-2 text-slate-600"><span className={`h-2.5 w-2.5 rounded-full ${color}`} />{label}</span>; }
function warehouseLabel(value: string) { return ({ ALL: "Все доступные склады", "WH-DEMO-CENTRAL": "Центральный", "WH-DEMO-MRO": "МРО", "WH-DEMO-PROJECT": "Проектный", "WH-DEMO-RESERVE": "Резервный" } as Record<string, string>)[value] ?? value; }
function departmentLabel(value: string) { return ({ ALL: "Все подразделения", PROJECT: "Проектный офис", PROCUREMENT: "Закупки", MAINTENANCE: "МТО и склад", ENGINEERING: "Инжиниринг" } as Record<string, string>)[value] ?? value; }
function processLabel(value: string) { return ({ ALL: "Все процессы", SPECIFICATION: "Обработка спецификаций", ANALYSIS: "Анализ МТР", EXPERT_REVIEW: "Экспертная проверка", SUPPLY: "Обеспечение" } as Record<string, string>)[value] ?? value; }
function categoryLabel(value: string) { return ({ ALL: "Вся номенклатура", PIPING: "Трубопроводы", VALVES: "Арматура", INSTRUMENTATION: "КИПиА", ELECTRICAL: "Электрика", ROTATING: "Вращающееся оборудование", MRO: "МРО" } as Record<string, string>)[value] ?? value; }

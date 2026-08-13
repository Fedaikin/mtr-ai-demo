import Link from "next/link";
import { redirect } from "next/navigation";

import { getRepository } from "@/adapters/persistence/repository";
import { deterministicInventoryForecast } from "@/domain/inventory-forecast";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
  integrationStatusLabel,
  integrationSystemLabel,
  roleLabel,
  scenarioLabel,
} from "@/lib/localization";
import { getDemoSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getDemoSession();
  if (!session.authorization.permissionKeys.has("project.read")) {
    if (session.authorization.permissionKeys.has("user.manage")) redirect("/admin/users");
    if (session.authorization.permissionKeys.has("audit.read.global")) redirect("/admin/audit");
    redirect("/forbidden");
  }
  const { user } = session;
  const repository = await getRepository();
  const [specifications, runs, completedRuns, integrations, counts, catalog, forecastCandidates] = await Promise.all([
    repository.listSpecifications(user.id),
    repository.listRuns(user.id, { limit: 10, includeSteps: false }),
    repository.listRuns(user.id, { status: "COMPLETED", limit: 20, includeSteps: false }),
    repository.listIntegrationStates(user.id),
    repository.getCounts(user.id),
    repository.getCatalogOverview(user.id),
    repository.searchCatalogItems(user.id, { limit: 8, offset: 0 }),
  ]);
  const lastRun = runs[0];
  const lastReportRun = completedRuns.find((run) => {
    const reportSnapshot = run.outputSnapshot.report;
    return reportSnapshot !== null && typeof reportSnapshot === "object";
  });
  const forecastDetails = await Promise.all(forecastCandidates.items.map((item) => repository.getCatalogItemByCode(user.id, item.itemCode)));
  const forecasts = forecastCandidates.items.map((item, index) => ({
    item,
    detail: forecastDetails[index],
    forecast: deterministicInventoryForecast(item.itemCode, item.totalAvailableQuantity),
  }));
  const openRuns = runs.filter((run) => ["PENDING", "RUNNING", "RETRYING"].includes(run.status)).length;
  const availableSources = integrations.filter((integration) => integration.state === "AVAILABLE").length;
  return (
    <>
      <PageHeader
        eyebrow="Рабочее место"
        title="Обзор анализа МТР"
        description="Промышленный каталог, складские остатки, спецификации и последние результаты анализа."
        action={<div className="flex flex-wrap gap-2"><Link href="/catalog" className="focus-ring inline-flex rounded-md border border-teal-700 bg-white px-4 py-2.5 text-sm font-semibold text-teal-800 hover:bg-teal-50">Открыть каталог</Link><Link href="/admin/scenarios" className="focus-ring inline-flex rounded-md bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-800">Запустить анализ</Link></div>}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <DashboardMetric label="Позиции каталога" value={catalog.items} hint={`${catalog.components} компонентов`} />
        <DashboardMetric label="Общий остаток" value={Math.max(0, Math.round(catalog.totalAvailableQuantity))} hint={`${catalog.stockedItems} позиций в наличии · целые ед.`} />
        <DashboardMetric label="Семейства замен" value={catalog.families} hint="подтверждённая совместимость" />
        <DashboardMetric label="Сборочные узлы" value={catalog.assemblies} hint={`${catalog.bomLinks} BOM-связей`} />
        <DashboardMetric label="Складские записи" value={catalog.stockBalanceRows} hint={`${catalog.multiWarehouseItems} на нескольких складах`} />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(300px,3fr)]">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Оперативная картина</p><h2 className="mt-1 text-lg font-semibold">Факты и текущие дефициты</h2><div className="mt-3 grid gap-2 text-xs sm:grid-cols-4"><OperationalFact label="Актуальные спецификации" value={specifications.length} /><OperationalFact label="Открытые анализы" value={openRuns} /><OperationalFact label="Доступные источники" value={`${availableSources}/${integrations.length}`} /><OperationalFact label="Зафиксировано событий" value={counts.auditLogs} /></div><p className="mt-4 text-sm text-slate-500">Сравнение целого складского остатка с расчётной потребностью на 30 дней.</p><div className="mt-3 divide-y divide-slate-100">{forecasts.slice(0, 6).map(({ item, forecast }) => <div key={item.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]"><Link href={`/catalog/${encodeURIComponent(item.itemCode)}`} className="font-mono text-xs font-semibold text-teal-800 hover:underline">{item.itemCode} · {item.nameRu}</Link><span className="text-sm text-slate-600">Остаток {forecast.stock}</span><span className={`text-sm font-semibold ${Math.max(0, forecast.dailyDemand * 30 - forecast.stock) > 0 ? "text-red-700" : "text-emerald-700"}`}>Дефицит {Math.max(0, forecast.dailyDemand * 30 - forecast.stock)}</span></div>)}</div></section>
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Прогноз</p><h2 className="mt-1 text-lg font-semibold">Риск на 90 дней</h2><p className="mt-1 text-sm text-slate-600">Не ML: прозрачный demo-расчёт по синтетической истории.</p><div className="mt-4 space-y-4">{forecasts.slice(0, 3).map(({ item, detail, forecast }) => { const daysToShortage = Math.max(1, Math.ceil(forecast.stock / forecast.dailyDemand)); const snapshot = detail?.latestSnapshotAt ? new Date(detail.latestSnapshotAt) : new Date("2026-08-11T00:00:00.000Z"); snapshot.setUTCDate(snapshot.getUTCDate() + daysToShortage); const warehouses = detail?.balances.map((balance) => `${balance.plant}/${balance.storageLocation}`).slice(0, 2).join(", ") || "demo-склад"; return <article key={item.id} className="rounded-lg border border-amber-200 bg-white/70 p-3"><div className="flex justify-between gap-3 text-sm"><Link href={`/catalog/${encodeURIComponent(item.itemCode)}`} className="font-semibold text-teal-900 hover:underline">{item.nameRu}</Link><span className="font-semibold text-amber-900">риск {forecast.shortage} ед.</span></div><p className="mt-1 font-mono text-[11px] text-slate-500">{item.itemCode} · {warehouses}</p><dl className="mt-2 grid grid-cols-2 gap-1 text-xs text-slate-600"><dt>Текущий остаток</dt><dd className="text-right font-medium">{forecast.stock} {item.unit}</dd><dt>Темп расхода</dt><dd className="text-right font-medium">{forecast.dailyDemand} {item.unit}/день</dd><dt>Окно дефицита</dt><dd className="text-right font-medium">с {snapshot.toLocaleDateString("ru-RU")}</dd><dt>Уверенность</dt><dd className="text-right font-medium">Средняя · 3 периода</dd></dl><p className="mt-2 text-xs leading-5 text-slate-600">{forecast.explanation}</p><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-900">Прогноз, не факт</span><Link href="/mtr-analysis" className="text-xs font-semibold text-teal-800 hover:underline">К решению человека</Link></div></article>; })}</div></section>
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Appius PLM</p><h2 className="mt-1 text-lg font-semibold">Мои спецификации</h2></div><Link href="/specifications" className="text-sm font-medium text-teal-800 hover:underline">Все</Link></div>
          <div className="divide-y divide-slate-100">{specifications.map((specification) => <Link key={specification.id} href={`/specifications/${specification.id}`} className="focus-ring grid gap-1 px-5 py-4 hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div><p className="text-sm font-semibold text-slate-900">{specification.name}</p><p className="mt-1 text-xs text-slate-500">{specification.projectCode} · актуальная версия {specification.latestVersionNumber}</p></div><span className="mt-2 text-sm tabular-nums text-slate-600 sm:mt-0">{specification.positionCount} поз.</span></Link>)}</div>
        </section>
        <div className="space-y-5">
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Данные пользователя</p><h2 className="mt-1 text-lg font-semibold">{user.displayName}</h2><dl className="mt-4 space-y-3 text-sm"><InfoRow name="Роль" value={user.roles.map(roleLabel).join(" · ")} /><InfoRow name="Спецификации" value={String(specifications.length)} /><InfoRow name="Запуски" value={String(counts.scenarioRuns)} /><InfoRow name="Последний запуск" value={lastRun ? formatDateTime(lastRun.createdAt) : "Нет запусков"} /><InfoRow name="Последний отчёт" value={lastReportRun ? formatDateTime(lastReportRun.completedAt ?? lastReportRun.updatedAt) : "Нет отчётов"} /></dl></section>
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Последний запуск</p><h2 className="mt-1 text-lg font-semibold">{lastRun ? scenarioLabel(lastRun.scenarioId) : "Запусков нет"}</h2></div>{lastRun ? <StatusPill status={lastRun.status} /> : null}</div>{lastRun ? <><p className="mt-3 text-xs text-slate-500">{formatDateTime(lastRun.createdAt)} · {lastRun.progress}%</p><Link href={`/runs/${lastRun.id}`} className="mt-4 inline-flex text-sm font-semibold text-teal-800 hover:underline">Открыть запуск</Link></> : <p className="mt-3 text-sm text-slate-500">Запустите первый анализ через раздел сценариев.</p>}</section>
        </div>
      </div>
      <section className="mt-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Интеграции</p><h2 className="mt-1 text-lg font-semibold">Оперативное состояние</h2></div><Link href="/admin/integrations" className="text-sm font-medium text-teal-800 hover:underline">Управление</Link></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{integrations.map((integration) => <div key={integration.system} data-testid={`dashboard-integration-${integration.system.toLowerCase()}`} className="rounded-md border border-slate-200 p-3"><div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">{integrationSystemLabel(integration.system)}</span><span className={`h-2 w-2 rounded-full ${integration.state === "AVAILABLE" ? "bg-emerald-500" : "bg-amber-500"}`} /></div><p className="mt-1 text-xs text-slate-500">{integrationStatusLabel(integration.state)} · задержка {integration.delayMs} мс</p></div>)}</div></section>
    </>
  );
}

function DashboardMetric({ label, value, hint, warning = false }: { label: string; value: number; hint: string; warning?: boolean }) { return <div className={`rounded-lg border p-4 shadow-sm ${warning ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(value)}</p><p className="mt-1 text-[11px] text-slate-500">{hint}</p></div>; }
function OperationalFact({ label, value }: { label: string; value: string | number }) { return <div className="rounded-md bg-slate-50 p-2"><p className="text-slate-500">{label}</p><p className="mt-1 font-semibold text-slate-900">{value}</p></div>; }
function InfoRow({ name, value }: { name: string; value: string }) { return <div className="flex justify-between gap-4"><dt className="text-slate-500">{name}</dt><dd className="text-right font-medium">{value}</dd></div>; }

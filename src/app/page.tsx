import Link from "next/link";

import { getRepository } from "@/adapters/persistence/repository";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
  integrationStatusLabel,
  integrationSystemLabel,
  roleLabel,
  scenarioLabel,
} from "@/lib/localization";
import { requireDemoRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [{ user }, repository] = await Promise.all([requireDemoRole("USER"), getRepository()]);
  const [specifications, runs, completedRuns, integrations, counts, catalog, catalogPreview] = await Promise.all([
    repository.listSpecifications(user.id),
    repository.listRuns(user.id, { limit: 10, includeSteps: false }),
    repository.listRuns(user.id, { status: "COMPLETED", limit: 20, includeSteps: false }),
    repository.listIntegrationStates(user.id),
    repository.getCounts(user.id),
    repository.getCatalogOverview(user.id),
    repository.searchCatalogItems(user.id, { limit: 6, offset: 0 }),
  ]);
  const lastRun = runs[0];
  const lastReportRun = completedRuns.find((run) => {
    const reportSnapshot = run.outputSnapshot.report;
    return reportSnapshot !== null && typeof reportSnapshot === "object";
  });
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
        <DashboardMetric label="Общий остаток" value={catalog.totalAvailableQuantity} hint={`${catalog.stockedItems} позиций в наличии`} />
        <DashboardMetric label="Семейства замен" value={catalog.families} hint="подтверждённая совместимость" />
        <DashboardMetric label="Сборочные узлы" value={catalog.assemblies} hint={`${catalog.bomLinks} BOM-связей`} />
        <DashboardMetric label="Складские записи" value={catalog.stockBalanceRows} hint={`${catalog.multiWarehouseItems} на нескольких складах`} />
      </div>
      <section className="mt-5 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Промышленный каталог</p><h2 className="mt-1 text-lg font-semibold">Реальные по масштабу позиции и остатки</h2><p className="mt-1 text-sm text-slate-500">Суммарный доступный остаток: {catalog.totalAvailableQuantity.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} условных единиц · снимок {formatDateTime(catalog.latestSnapshotAt)}</p></div>
          <Link href="/catalog" className="text-sm font-semibold text-teal-800 hover:underline">Все {catalog.items.toLocaleString("ru-RU")} позиций</Link>
        </div>
        <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-3">
          {catalogPreview.items.map((item) => <Link key={item.id} href={`/catalog/${encodeURIComponent(item.itemCode)}`} className="focus-ring p-4 hover:bg-slate-50"><p className="font-mono text-xs font-semibold text-teal-800">{item.itemCode}</p><p className="mt-1 text-sm font-medium text-slate-950">{item.nameRu}</p><p className="mt-2 text-xs text-slate-500">{item.equipmentType} · {item.totalAvailableQuantity.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} {item.unit} · {item.balanceCount} склад.</p></Link>)}
        </div>
      </section>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Appius PLM</p><h2 className="mt-1 text-lg font-semibold">Мои спецификации</h2></div><Link href="/specifications" className="text-sm font-medium text-teal-800 hover:underline">Все</Link></div>
          <div className="divide-y divide-slate-100">{specifications.map((specification) => <Link key={specification.id} href={`/specifications/${specification.id}`} className="focus-ring grid gap-1 px-5 py-4 hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div><p className="text-sm font-semibold text-slate-900">{specification.name}</p><p className="mt-1 text-xs text-slate-500">{specification.projectCode} · актуальная версия {specification.latestVersionNumber}</p></div><span className="mt-2 text-sm tabular-nums text-slate-600 sm:mt-0">{specification.positionCount} поз.</span></Link>)}</div>
        </section>
        <div className="space-y-5">
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Данные пользователя</p><h2 className="mt-1 text-lg font-semibold">{user.displayName}</h2><dl className="mt-4 space-y-3 text-sm"><InfoRow name="Роль" value={user.roles.map(roleLabel).join(" · ")} /><InfoRow name="Спецификации" value={String(specifications.length)} /><InfoRow name="Запуски" value={String(counts.scenarioRuns)} /><InfoRow name="Последний запуск" value={lastRun ? formatDateTime(lastRun.createdAt) : "Нет запусков"} /><InfoRow name="Последний отчёт" value={lastReportRun ? formatDateTime(lastReportRun.completedAt ?? lastReportRun.updatedAt) : "Нет отчётов"} /></dl></section>
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Последний запуск</p><h2 className="mt-1 text-lg font-semibold">{lastRun ? scenarioLabel(lastRun.scenarioId) : "Запусков нет"}</h2></div>{lastRun ? <StatusPill status={lastRun.status} /> : null}</div>{lastRun ? <><p className="mt-3 text-xs text-slate-500">{formatDateTime(lastRun.createdAt)} · {lastRun.progress}%</p><Link href={`/runs/${lastRun.id}`} className="mt-4 inline-flex text-sm font-semibold text-teal-800 hover:underline">Открыть запуск</Link></> : <p className="mt-3 text-sm text-slate-500">Запустите первый анализ через админку.</p>}</section>
        </div>
      </div>
      <section className="mt-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Интеграции</p><h2 className="mt-1 text-lg font-semibold">Оперативное состояние</h2></div><Link href="/admin/integrations" className="text-sm font-medium text-teal-800 hover:underline">Управление</Link></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{integrations.map((integration) => <div key={integration.system} data-testid={`dashboard-integration-${integration.system.toLowerCase()}`} className="rounded-md border border-slate-200 p-3"><div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">{integrationSystemLabel(integration.system)}</span><span className={`h-2 w-2 rounded-full ${integration.state === "AVAILABLE" ? "bg-emerald-500" : "bg-amber-500"}`} /></div><p className="mt-1 text-xs text-slate-500">{integrationStatusLabel(integration.state)} · задержка {integration.delayMs} мс</p></div>)}</div></section>
    </>
  );
}

function DashboardMetric({ label, value, hint, warning = false }: { label: string; value: number; hint: string; warning?: boolean }) { return <div className={`rounded-lg border p-4 shadow-sm ${warning ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(value)}</p><p className="mt-1 text-[11px] text-slate-500">{hint}</p></div>; }
function InfoRow({ name, value }: { name: string; value: string }) { return <div className="flex justify-between gap-4"><dt className="text-slate-500">{name}</dt><dd className="text-right font-medium">{value}</dd></div>; }

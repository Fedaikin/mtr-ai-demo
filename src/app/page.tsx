import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getRepository } from "@/adapters/persistence/repository";
import { deterministicInventoryForecast } from "@/domain/inventory-forecast";
import { dashboardAudienceForPersona, type DashboardAudience } from "@/domain/demo-personas";
import { ROLE_LABELS } from "@/domain/rbac";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
  integrationStatusLabel,
  integrationSystemLabel,
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
  const canCreateAnalysis = session.authorization.permissionKeys.has("analysis.create");
  const canReview = session.authorization.permissionKeys.has("review.queue.read");
  const primaryProjectRole = session.authorization.projectRoleKeys.includes("PROJECT_MANAGER") ? "PROJECT_MANAGER" : session.authorization.projectRoleKeys.includes("MTR_EXPERT") ? "MTR_EXPERT" : session.authorization.projectRoleKeys.includes("MTR_ANALYST") ? "MTR_ANALYST" : "PROJECT_VIEWER";
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
  const failedRuns = runs.filter((run) => run.status === "FAILED").length;
  const completedRunCount = runs.filter((run) => run.status === "COMPLETED").length;
  const availableSources = integrations.filter((integration) => integration.state === "AVAILABLE").length;
  const shortageForecasts = forecasts.filter(({ forecast }) => forecast.shortage > 0);
  const shortageTotal = shortageForecasts.reduce((total, { forecast }) => total + forecast.shortage, 0);
  const dashboardAudience = dashboardAudienceForPersona(user.login, session.authorization.projectRoleKeys);
  const dashboardRoleLabel = dashboardAudience === "EXECUTIVE" ? "Руководитель" : dashboardAudience === "MANAGER" ? "Менеджер проекта" : ROLE_LABELS[primaryProjectRole];
  return (
    <>
      <PageHeader
        eyebrow="Рабочее место"
        title="Обзор анализа МТР"
        description="Промышленный каталог, складские остатки, спецификации и последние результаты анализа."
        action={<div className="flex flex-wrap gap-2"><Link href="/catalog" className="focus-ring inline-flex rounded-md border border-teal-700 bg-white px-4 py-2.5 text-sm font-semibold text-teal-800 hover:bg-teal-50">Открыть каталог</Link>{canCreateAnalysis ? <Link href="/admin/scenarios" className="focus-ring inline-flex rounded-md bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-800">Запустить анализ</Link> : null}{canReview ? <Link href="/reviews" className="focus-ring inline-flex rounded-md bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700">Открыть очередь эксперта</Link> : null}</div>}
      />
      <RoleOverviewDashboard
        audience={dashboardAudience}
        role={primaryProjectRole}
        userName={user.displayName}
        openRuns={openRuns}
        completedRuns={completedRunCount}
        failedRuns={failedRuns}
        totalRuns={runs.length}
        specificationCount={specifications.length}
        shortageCount={shortageForecasts.length}
        shortageTotal={shortageTotal}
        availableSources={availableSources}
        integrationCount={integrations.length}
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
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Данные пользователя</p><h2 className="mt-1 text-lg font-semibold">{user.displayName}</h2><dl className="mt-4 space-y-3 text-sm"><InfoRow name="Роль" value={dashboardRoleLabel} /><InfoRow name="Спецификации" value={String(specifications.length)} /><InfoRow name="Запуски" value={String(counts.scenarioRuns)} /><InfoRow name="Последний запуск" value={lastRun ? formatDateTime(lastRun.createdAt) : "Нет запусков"} /><InfoRow name="Последний отчёт" value={lastReportRun ? formatDateTime(lastReportRun.completedAt ?? lastReportRun.updatedAt) : "Нет отчётов"} /></dl></section>
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Последний запуск</p><h2 className="mt-1 text-lg font-semibold">{lastRun ? scenarioLabel(lastRun.scenarioId) : "Запусков нет"}</h2></div>{lastRun ? <StatusPill status={lastRun.status} /> : null}</div>{lastRun ? <><p className="mt-3 text-xs text-slate-500">{formatDateTime(lastRun.createdAt)} · {lastRun.progress}%</p><Link href={`/runs/${lastRun.id}`} className="mt-4 inline-flex text-sm font-semibold text-teal-800 hover:underline">Открыть запуск</Link></> : <p className="mt-3 text-sm text-slate-500">Запустите первый анализ через раздел сценариев.</p>}</section>
        </div>
      </div>
      <section className="mt-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Интеграции</p><h2 className="mt-1 text-lg font-semibold">Оперативное состояние</h2></div><Link href="/admin/integrations" className="text-sm font-medium text-teal-800 hover:underline">Управление</Link></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{integrations.map((integration) => <div key={integration.system} data-testid={`dashboard-integration-${integration.system.toLowerCase()}`} className="rounded-md border border-slate-200 p-3"><div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">{integrationSystemLabel(integration.system)}</span><span className={`h-2 w-2 rounded-full ${integration.state === "AVAILABLE" ? "bg-emerald-500" : "bg-amber-500"}`} /></div><p className="mt-1 text-xs text-slate-500">{integrationStatusLabel(integration.state)} · задержка {integration.delayMs} мс</p></div>)}</div></section>
    </>
  );
}

type ProjectRole = "PROJECT_VIEWER" | "MTR_ANALYST" | "MTR_EXPERT" | "PROJECT_MANAGER";

interface RoleOverviewDashboardProps {
  audience: DashboardAudience;
  role: ProjectRole;
  userName: string;
  openRuns: number;
  completedRuns: number;
  failedRuns: number;
  totalRuns: number;
  specificationCount: number;
  shortageCount: number;
  shortageTotal: number;
  availableSources: number;
  integrationCount: number;
}

function RoleOverviewDashboard(props: RoleOverviewDashboardProps) {
  if (props.audience === "SPECIALIST") return <SpecialistOverview {...props} />;
  if (props.audience === "MANAGER") return <ManagerOverview {...props} />;
  if (props.audience === "EXECUTIVE") return <ExecutiveOverview {...props} />;
  return <RoleWorkspacePanel role={props.role} />;
}

function SpecialistOverview({ role, userName, openRuns, completedRuns, failedRuns, specificationCount, shortageCount }: RoleOverviewDashboardProps) {
  const isExpert = role === "MTR_EXPERT";
  const activeTasks = Math.max(3, openRuns + (isExpert ? 4 : 3));
  const load = Math.min(96, 58 + activeTasks * 5);
  const tasks = isExpert
    ? [
        ["Проверить 6 позиций Даблчекера", "Сегодня, 16:00", "/reviews"],
        ["Зафиксировать обоснование по насосу НЦС-180", "Сегодня, 18:00", "/reviews"],
        ["Вернуть неоднозначный аналог на уточнение", "Завтра, 12:00", "/mtr-analysis"],
      ]
    : [
        ["Завершить проверку спецификации КМ-204", "Сегодня, 17:00", "/specifications"],
        ["Запустить анализ обновлённой версии", "Завтра, 10:00", "/admin/scenarios"],
        ["Передать спорные позиции эксперту", "Завтра, 14:00", "/mtr-analysis"],
      ];
  return <section className="mb-5 space-y-4" aria-label="Персональный обзор специалиста">
    <RoleOverviewHeader eyebrow="Персональный обзор" title="Рабочий день специалиста" description={`${userName}: личная загрузка, ближайшие сроки и действия, требующие внимания.`} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><AudienceMetric label="Личная загрузка" value={`${load}%`} hint={`${activeTasks} задач в работе`} tone={load >= 85 ? "warning" : "default"} /><AudienceMetric label="Выполнено" value={completedRuns} hint="за текущий период" tone="success" /><AudienceMetric label="Активные анализы" value={openRuns} hint="в личной очереди" /><AudienceMetric label="Предупреждения" value={failedRuns + shortageCount} hint="сроки и дефициты" tone={failedRuns + shortageCount > 0 ? "danger" : "success"} /></div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.55fr)]">
      <DashboardCard eyebrow="Мои задачи" title="Текущая очередь"><div className="divide-y divide-slate-100">{tasks.map(([label, deadline, href], index) => <Link key={label} href={href} className="grid gap-2 py-3 hover:text-teal-800 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"><span className={`h-2.5 w-2.5 rounded-full ${index === 0 ? "bg-red-500" : index === 1 ? "bg-amber-500" : "bg-teal-500"}`} /><span className="text-sm font-medium">{label}</span><span className="text-xs font-semibold text-slate-500">{deadline}</span></Link>)}</div></DashboardCard>
      <DashboardCard eyebrow="Внимание" title="Сроки и предупреждения"><AlertLine tone="danger" title="1 задача близка к SLA" text="До контрольного срока менее 4 часов." /><AlertLine tone="warning" title={`${Math.max(1, shortageCount)} поз. требуют проверки`} text="Есть риск дефицита или неоднозначный аналог." /><AlertLine tone="neutral" title={`${specificationCount} спецификации доступны`} text="Последняя версия синхронизирована с проектом." /></DashboardCard>
    </div>
  </section>;
}

function ManagerOverview({ openRuns, failedRuns, shortageCount, availableSources, integrationCount }: RoleOverviewDashboardProps) {
  const deviations = Math.max(2, failedRuns + shortageCount);
  return <section className="mb-5 space-y-4" aria-label="Командный обзор менеджера">
    <RoleOverviewHeader eyebrow="Командный обзор" title="Состояние команды и потока работ" description="Загрузка специалистов, отклонения от плана, узкие места и рекомендации на ближайший цикл." />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><AudienceMetric label="Команда" value="8" hint="6 в работе · 2 доступны" tone="success" /><AudienceMetric label="В срок" value="84%" hint="SLA командных задач" /><AudienceMetric label="Отклонения" value={deviations} hint="требуют вмешательства" tone="danger" /><AudienceMetric label="Активные анализы" value={openRuns} hint="по всем специалистам" /></div>
    <div className="grid gap-4 xl:grid-cols-3">
      <DashboardCard eyebrow="Команда" title="Загрузка специалистов"><TeamLoad name="Анна Морозова" role="Аналитик МТР" load={92} tasks={7} /><TeamLoad name="Илья Воронцов" role="Эксперт МТР" load={86} tasks={6} /><TeamLoad name="Мария Орлова" role="Аналитик МТР" load={61} tasks={4} /><TeamLoad name="Денис Егоров" role="Эксперт МТР" load={48} tasks={3} /></DashboardCard>
      <DashboardCard eyebrow="Отклонения" title="Узкие места"><AlertLine tone="danger" title="Экспертная очередь растёт" text="6 решений ожидают более 8 часов." /><AlertLine tone="warning" title="Неравномерная загрузка" text="Два специалиста загружены более чем на 85%." /><AlertLine tone="warning" title="Синхронизация источников" text={`Доступно ${availableSources} из ${integrationCount} интеграций.`} /></DashboardCard>
      <DashboardCard eyebrow="Рекомендации" title="Следующие действия"><Recommendation index="01" title="Перераспределить 2 задания" text="Передать свободному эксперту позиции с высоким приоритетом." /><Recommendation index="02" title="Разобрать критическую очередь" text="Провести 15-минутный разбор отклонений до 16:00." /><Recommendation index="03" title="Зафиксировать план" text="Согласовать владельцев позиций с риском дефицита." /></DashboardCard>
    </div>
  </section>;
}

function ExecutiveOverview({ totalRuns, completedRuns, failedRuns, shortageCount, shortageTotal, availableSources, integrationCount }: RoleOverviewDashboardProps) {
  const sla = totalRuns === 0 ? 96 : Math.round((completedRuns / Math.max(1, totalRuns)) * 100);
  const sourceHealth = integrationCount === 0 ? 100 : Math.round((availableSources / integrationCount) * 100);
  return <section className="mb-5 space-y-4" aria-label="Управленческий обзор руководителя">
    <RoleOverviewHeader eyebrow="Управленческий обзор" title="KPI, риски и варианты решений" description="Консолидированная картина проекта для принятия решений без операционных деталей." />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><AudienceMetric label="SLA анализа" value={`${sla}%`} hint="цель ≥ 95%" tone={sla >= 95 ? "success" : "warning"} /><AudienceMetric label="Стабильность данных" value={`${sourceHealth}%`} hint="доступность источников" tone={sourceHealth >= 90 ? "success" : "warning"} /><AudienceMetric label="Критические риски" value={Math.max(2, failedRuns + shortageCount)} hint="нужны владельцы" tone="danger" /><AudienceMetric label="Прогноз дефицита" value={shortageTotal} hint="единиц на горизонте 90 дней" tone="warning" /><AudienceMetric label="Завершено анализов" value={completedRuns} hint="в текущем срезе" /></div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <DashboardCard eyebrow="Критические риски" title="Что требует решения"><RiskRow level="Критический" title="Дефицит насосного оборудования" impact="Сдвиг поставки до 12 дней" /><RiskRow level="Высокий" title="Очередь экспертного согласования" impact="Риск нарушения SLA по 6 позициям" /><RiskRow level="Средний" title="Неполная доступность источников" impact="Снижение точности прогноза" /></DashboardCard>
      <DashboardCard eyebrow="Варианты решений" title="Рекомендованные сценарии"><DecisionOption title="Перераспределить доступный остаток" effect="–62% прогнозного дефицита" effort="Без доп. закупки" href="/mtr-analysis" /><DecisionOption title="Ускорить экспертную проверку" effect="SLA до 97%" effort="+1 эксперт на 2 дня" href="/mtr-analysis" /><DecisionOption title="Запустить поиск подтверждённых аналогов" effect="До 18 позиций закрыто" effort="Контроль специалиста" href="/catalog" /></DashboardCard>
    </div>
  </section>;
}

function RoleOverviewHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="rounded-xl border border-teal-200 bg-gradient-to-r from-slate-950 via-teal-950 to-teal-800 p-5 text-white shadow-sm"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-200">{eyebrow}</p><h2 className="mt-2 text-2xl font-semibold">{title}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-teal-50/80">{description}</p></div>;
}

function AudienceMetric({ label, value, hint, tone = "default" }: { label: string; value: string | number; hint: string; tone?: "default" | "success" | "warning" | "danger" }) {
  const styles = { default: "border-slate-200 bg-white", success: "border-emerald-200 bg-emerald-50/70", warning: "border-amber-200 bg-amber-50/70", danger: "border-red-200 bg-red-50/70" }[tone];
  return <div className={`rounded-lg border p-4 shadow-sm ${styles}`}><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{value}</p><p className="mt-1 text-[11px] text-slate-500">{hint}</p></div>;
}

function DashboardCard({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-teal-700">{eyebrow}</p><h3 className="mt-1 text-lg font-semibold text-slate-950">{title}</h3><div className="mt-3">{children}</div></section>;
}

function AlertLine({ tone, title, text }: { tone: "danger" | "warning" | "neutral"; title: string; text: string }) {
  const dot = { danger: "bg-red-500", warning: "bg-amber-500", neutral: "bg-slate-400" }[tone];
  return <div className="flex gap-3 border-b border-slate-100 py-3 last:border-0"><span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} /><div><p className="text-sm font-semibold text-slate-900">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{text}</p></div></div>;
}

function TeamLoad({ name, role, load, tasks }: { name: string; role: string; load: number; tasks: number }) {
  const bar = load >= 85 ? "bg-red-500" : load >= 70 ? "bg-amber-500" : "bg-teal-600";
  return <div className="border-b border-slate-100 py-3 last:border-0"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{name}</p><p className="text-xs text-slate-500">{role} · {tasks} задач</p></div><span className="text-sm font-semibold tabular-nums">{load}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${bar}`} style={{ width: `${load}%` }} /></div></div>;
}

function Recommendation({ index, title, text }: { index: string; title: string; text: string }) {
  return <div className="flex gap-3 border-b border-slate-100 py-3 last:border-0"><span className="font-mono text-xs font-semibold text-teal-700">{index}</span><div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{text}</p></div></div>;
}

function RiskRow({ level, title, impact }: { level: string; title: string; impact: string }) {
  return <div className="border-b border-slate-100 py-3 last:border-0"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{title}</p><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${level === "Критический" ? "bg-red-100 text-red-800" : level === "Высокий" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>{level}</span></div><p className="mt-1 text-xs text-slate-500">Влияние: {impact}</p></div>;
}

function DecisionOption({ title, effect, effort, href }: { title: string; effect: string; effort: string; href: string }) {
  return <Link href={href} className="focus-ring grid gap-2 border-b border-slate-100 py-3 last:border-0 hover:text-teal-800 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"><span className="text-sm font-semibold">{title}</span><span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">{effect}</span><span className="text-xs text-slate-500">{effort}</span></Link>;
}

function RoleWorkspacePanel({ role }: { role: "PROJECT_VIEWER" | "MTR_ANALYST" | "MTR_EXPERT" | "PROJECT_MANAGER" }) {
  const content = {
    PROJECT_VIEWER: { eyebrow: "Режим наблюдателя", title: "Контроль без изменений", description: "Доступны спецификации, каталог, результаты анализа и отчёты. Запуск анализа, складской поиск и экспертные решения скрыты.", links: [["Просмотреть спецификации", "/specifications"], ["Открыть МТР-анализ", "/mtr-analysis"]] },
    MTR_ANALYST: { eyebrow: "Рабочее место аналитика", title: "Подготовка и запуск анализа", description: "Загружайте и публикуйте спецификации, проверяйте складские данные и запускайте сценарии анализа МТР.", links: [["Работа со спецификациями", "/specifications"], ["Запустить сценарий", "/admin/scenarios"]] },
    MTR_EXPERT: { eyebrow: "Рабочее место эксперта", title: "Даблчекер и экспертное решение", description: "Разбирайте очередь независимой проверки, подтверждайте или отклоняйте результаты и фиксируйте обоснование.", links: [["Очередь Даблчекера", "/reviews"], ["Полный МТР-анализ", "/mtr-analysis"]] },
    PROJECT_MANAGER: { eyebrow: "Рабочее место руководителя", title: "Проект, команда и итоговые отчёты", description: "Управляйте участниками, контролируйте запуски и экспертную очередь, публикуйте итоговые отчёты проекта.", links: [["Участники проекта", "/projects/demo-project-001/members"], ["Сценарии и запуски", "/admin/scenarios"]] },
  }[role];
  return <section className="mb-5 rounded-xl border border-teal-200 bg-gradient-to-r from-teal-50 to-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-teal-700">{content.eyebrow}</p><div className="mt-2 flex flex-wrap items-end justify-between gap-4"><div className="max-w-3xl"><h2 className="text-xl font-semibold text-slate-950">{content.title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{content.description}</p></div><div className="flex flex-wrap gap-2">{content.links.map(([label, href]) => <Link key={href} href={href} className="focus-ring rounded-md border border-teal-200 bg-white px-3 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-100">{label}</Link>)}</div></div></section>;
}

function DashboardMetric({ label, value, hint, warning = false }: { label: string; value: number; hint: string; warning?: boolean }) { return <div className={`rounded-lg border p-4 shadow-sm ${warning ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(value)}</p><p className="mt-1 text-[11px] text-slate-500">{hint}</p></div>; }
function OperationalFact({ label, value }: { label: string; value: string | number }) { return <div className="rounded-md bg-slate-50 p-2"><p className="text-slate-500">{label}</p><p className="mt-1 font-semibold text-slate-900">{value}</p></div>; }
function InfoRow({ name, value }: { name: string; value: string }) { return <div className="flex justify-between gap-4"><dt className="text-slate-500">{name}</dt><dd className="text-right font-medium">{value}</dd></div>; }

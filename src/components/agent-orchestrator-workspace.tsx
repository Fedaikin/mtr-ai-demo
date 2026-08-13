"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AgentChat, type AgentThreadView } from "@/components/agent-chat";
import type { PublicAgentCase } from "@/domain/agent/case";
import type { PublicAgentActionProposal } from "@/domain/agent/actions";
import type { WeeklyDigest } from "@/domain/agent/digest";
import type { PublicAgentProactiveInsight } from "@/domain/agent/events";
import type { AgentContextSelection } from "@/domain/agent/context";

export interface AgentWorkspaceOption {
  readonly id: string;
  readonly label: string;
}

export interface AgentWorkspacePositionOption extends AgentWorkspaceOption {
  readonly specificationId: string;
}

interface AgentOrchestratorWorkspaceProps {
  readonly displayName: string;
  readonly project: AgentWorkspaceOption;
  readonly specifications: readonly AgentWorkspaceOption[];
  readonly positions: readonly AgentWorkspacePositionOption[];
  readonly runs: readonly AgentWorkspaceOption[];
  readonly initialContext: AgentContextSelection;
  readonly initialThreads: AgentThreadView[];
  readonly initialPeriod: Readonly<{ from: string; to: string }>;
}

type WorkspacePanel = "CASES" | "DIGEST" | "INSIGHTS" | "ACTIONS";

interface WorkspaceData {
  readonly cases: readonly PublicAgentCase[];
  readonly digest: WeeklyDigest | null;
  readonly insights: readonly PublicAgentProactiveInsight[];
  readonly actions: readonly PublicAgentActionProposal[];
  readonly unavailable: ReadonlySet<WorkspacePanel>;
}

const EMPTY_DATA: WorkspaceData = {
  cases: [],
  digest: null,
  insights: [],
  actions: [],
  unavailable: new Set(),
};

const DATE_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});

export function AgentOrchestratorWorkspace({
  displayName,
  project,
  specifications,
  positions,
  runs,
  initialContext,
  initialThreads,
  initialPeriod,
}: AgentOrchestratorWorkspaceProps) {
  const [specificationId, setSpecificationId] = useState(initialContext.specificationId ?? "");
  const [positionId, setPositionId] = useState(initialContext.positionId ?? "");
  const [runId, setRunId] = useState(initialContext.runId ?? "");
  const [periodFrom, setPeriodFrom] = useState(dateInputValue(initialPeriod.from));
  const [periodTo, setPeriodTo] = useState(dateInputValue(initialPeriod.to));
  const [panel, setPanel] = useState<WorkspacePanel>("CASES");
  const [data, setData] = useState<WorkspaceData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const visiblePositions = useMemo(
    () => positions.filter((position) => !specificationId || position.specificationId === specificationId),
    [positions, specificationId],
  );
  const context = useMemo<AgentContextSelection>(() => ({
    projectId: project.id,
    ...(specificationId ? { specificationId } : {}),
    ...(positionId ? { positionId } : {}),
    ...(runId ? { runId } : {}),
    ...(periodFrom && periodTo && periodFrom <= periodTo
      ? { period: { from: startOfDay(periodFrom), to: endOfDay(periodTo) } }
      : {}),
  }), [periodFrom, periodTo, positionId, project.id, runId, specificationId]);

  useEffect(() => {
    let active = true;
    void loadWorkspaceData().then((value) => {
      if (active) {
        setData(value);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, []);

  async function updateAction(id: string, operation: "confirm" | "cancel") {
    if (pendingActionId) return;
    setPendingActionId(id);
    setActionError(null);
    try {
      const updated = await apiJson<PublicAgentActionProposal>(
        `/api/agent/actions/${encodeURIComponent(id)}/${operation}`,
        { method: "POST" },
      );
      setData((current) => ({
        ...current,
        actions: current.actions.map((action) => action.id === updated.id ? updated : action),
      }));
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setPendingActionId(null);
    }
  }

  function chooseSpecification(value: string) {
    setSpecificationId(value);
    setPositionId("");
  }

  return (
    <section id="agent-workspace" aria-labelledby="agent-workspace-title" className="mb-8 scroll-mt-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Единый оркестратор</p>
            <h2 id="agent-workspace-title" className="mt-1 text-xl font-semibold text-slate-950">Рабочее пространство МТР-агента</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">Диалог, быстрые команды, личные кейсы, сводка, сигналы и подтверждаемые действия используют один доверенный контекст.</p>
          </div>
          <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-900">Синтетический демо-контур</span>
        </div>

        <div className="mt-5 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Контекст МТР-агента">
          <ContextField label="Проект">
            <select aria-label="Проект МТР-агента" value={project.id} disabled className={selectClassName()}><option value={project.id}>{project.label}</option></select>
          </ContextField>
          <ContextField label="Спецификация">
            <select aria-label="Спецификация МТР-агента" value={specificationId} onChange={(event) => chooseSpecification(event.target.value)} className={selectClassName()}>
              <option value="">Все доступные</option>
              {specifications.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </ContextField>
          <ContextField label="Позиция">
            <select aria-label="Позиция МТР-агента" value={positionId} onChange={(event) => setPositionId(event.target.value)} className={selectClassName()}>
              <option value="">Все доступные</option>
              {visiblePositions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </ContextField>
          <ContextField label="Запуск">
            <select aria-label="Запуск МТР-агента" value={runId} onChange={(event) => setRunId(event.target.value)} className={selectClassName()}>
              <option value="">Без привязки</option>
              {runs.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </ContextField>
          <div className="grid grid-cols-2 gap-2">
            <ContextField label="Период с"><input aria-label="Начало периода МТР-агента" type="date" value={periodFrom} max={periodTo} onChange={(event) => setPeriodFrom(event.target.value)} className={selectClassName()} /></ContextField>
            <ContextField label="по"><input aria-label="Конец периода МТР-агента" type="date" value={periodTo} min={periodFrom} onChange={(event) => setPeriodTo(event.target.value)} className={selectClassName()} /></ContextField>
          </div>
        </div>
      </div>

      <div className="mt-4 grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="h-[760px] min-h-0 min-w-0 sm:h-[820px] xl:h-[760px]">
          <AgentChat displayName={displayName} initialThreads={initialThreads} initialThreadId={null} initialMessages={[]} context={context} />
        </div>
        <aside aria-label="Рабочие материалы МТР-агента" className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm xl:h-[760px]">
          <div className="grid grid-cols-2 gap-1 border-b border-slate-200 bg-slate-50 p-2">
            <PanelButton active={panel === "CASES"} onClick={() => setPanel("CASES")}>Кейсы · {data.cases.length}</PanelButton>
            <PanelButton active={panel === "DIGEST"} onClick={() => setPanel("DIGEST")}>Сводка</PanelButton>
            <PanelButton active={panel === "INSIGHTS"} onClick={() => setPanel("INSIGHTS")}>Сигналы · {data.insights.length}</PanelButton>
            <PanelButton active={panel === "ACTIONS"} onClick={() => setPanel("ACTIONS")}>Действия · {data.actions.length}</PanelButton>
          </div>
          <div className="max-h-[680px] overflow-y-auto p-4 xl:h-[700px]" aria-live="polite">
            {loading ? <PanelLoading /> : null}
            {!loading && panel === "CASES" ? <CasesPanel items={data.cases} unavailable={data.unavailable.has("CASES")} onContinue={(item) => {
              setSpecificationId(item.contextSnapshot.specificationId ?? "");
              setPositionId(item.contextSnapshot.positionId ?? "");
              setRunId(item.contextSnapshot.runId ?? "");
              document.getElementById("agent-workspace-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }} /> : null}
            {!loading && panel === "DIGEST" ? <DigestPanel digest={data.digest} unavailable={data.unavailable.has("DIGEST")} /> : null}
            {!loading && panel === "INSIGHTS" ? <InsightsPanel items={data.insights} unavailable={data.unavailable.has("INSIGHTS")} /> : null}
            {!loading && panel === "ACTIONS" ? <ActionsPanel items={data.actions} unavailable={data.unavailable.has("ACTIONS")} pendingId={pendingActionId} error={actionError} onAction={updateAction} /> : null}
          </div>
        </aside>
      </div>
    </section>
  );
}

function ContextField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block min-w-0"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>{children}</label>;
}

function PanelButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} aria-pressed={active} className={`focus-ring rounded-md px-2.5 py-2 text-xs font-semibold ${active ? "bg-white text-teal-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:bg-white hover:text-slate-950"}`}>{children}</button>;
}

function CasesPanel({ items, unavailable, onContinue }: { items: readonly PublicAgentCase[]; unavailable: boolean; onContinue: (item: PublicAgentCase) => void }) {
  if (unavailable) return <PanelEmpty title="Кейсы недоступны" detail="Контур кейсов отключён или временно недоступен." />;
  if (items.length === 0) return <PanelEmpty title="Кейсов пока нет" detail="Они появятся после сохранения сложного контекста или выполнения команды." />;
  return <div className="space-y-3"><PanelTitle title="Личные кейсы" detail="Только активный проект и текущий пользователь" />{items.map((item) => <article key={item.id} className="rounded-lg border border-slate-200 p-3"><div className="flex items-start justify-between gap-3"><h3 className="text-sm font-semibold text-slate-900">{item.title}</h3><StatusBadge>{caseStatusLabel(item.status)}</StatusBadge></div><p className="mt-2 text-xs text-slate-500">Обновлён {formatDateTime(item.updatedAt)} · источников {item.evidence.length}</p>{item.revokedEvidenceCount > 0 ? <p className="mt-2 text-xs font-medium text-amber-800">Скрыто источников после повторной авторизации: {item.revokedEvidenceCount}</p> : null}<button type="button" onClick={() => onContinue(item)} className="focus-ring mt-3 rounded-md border border-teal-200 px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-50">Продолжить в этом контексте</button></article>)}</div>;
}

function DigestPanel({ digest, unavailable }: { digest: WeeklyDigest | null; unavailable: boolean }) {
  if (unavailable || !digest) return <PanelEmpty title="Сводка недоступна" detail="Не удалось получить персональную недельную сводку." />;
  return <div className="space-y-4"><PanelTitle title="Недельная сводка" detail={`${formatDateTime(digest.period.from)} — ${formatDateTime(digest.period.to)}`} /><StatusBadge>{digestStatusLabel(digest.status)}</StatusBadge><div className="grid grid-cols-2 gap-2">{digest.comparison.map((metric) => <div key={metric.key} className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] text-slate-500">{digestMetricLabel(metric.key)}</p><p className="mt-1 text-lg font-semibold tabular-nums">{metric.current}</p><p className={`text-xs ${metric.delta > 0 ? "text-amber-700" : "text-slate-500"}`}>{metric.delta > 0 ? "+" : ""}{metric.delta} к прошлой неделе</p></div>)}</div>{digest.sections.tasks.length > 0 ? <section><h3 className="text-sm font-semibold">Ближайшие задания</h3><ul className="mt-2 space-y-2">{digest.sections.tasks.slice(0, 5).map((task) => <li key={task.id}><Link href={task.href} className="focus-ring block rounded-lg border border-slate-200 p-3 text-sm hover:border-teal-300"><span className="font-medium">{task.title}</span><span className="mt-1 block text-xs text-slate-500">{taskStatusLabel(task.status)}</span></Link></li>)}</ul></section> : null}<section><h3 className="text-sm font-semibold">Следующие шаги</h3><ul className="mt-2 space-y-2">{digest.recommendedActions.map((action) => <li key={action.id}><Link href={action.href} className="focus-ring block rounded-lg bg-teal-50 p-3 text-sm text-teal-950 hover:bg-teal-100"><span className="font-semibold">{action.label}</span><span className="mt-1 block text-xs text-teal-800">{action.nextStep}</span></Link></li>)}</ul></section></div>;
}

function InsightsPanel({ items, unavailable }: { items: readonly PublicAgentProactiveInsight[]; unavailable: boolean }) {
  if (unavailable) return <PanelEmpty title="Сигналы недоступны" detail="Проактивный контур отключён или временно недоступен." />;
  if (items.length === 0) return <PanelEmpty title="Активных сигналов нет" detail="Агент покажет здесь дедуплицированные события, требующие внимания." />;
  return <div className="space-y-3"><PanelTitle title="Проактивные сигналы" detail="Дедупликация по объекту и версии состояния" />{items.map((item) => <article key={item.id} className="rounded-lg border border-slate-200 p-3"><div className="flex items-start justify-between gap-3"><h3 className="text-sm font-semibold">{item.title}</h3><RiskBadge level={item.level} /></div><p className="mt-2 text-sm leading-5 text-slate-600">{item.summary}</p><p className="mt-3 rounded-md bg-slate-50 p-2 text-xs text-slate-700"><span className="font-semibold">Рекомендуется:</span> {item.recommendedAction}</p><p className="mt-2 text-[11px] text-slate-500">Обновлён {formatDateTime(item.lastSeenAt)} · правило {item.ruleVersion}</p></article>)}</div>;
}

function ActionsPanel({ items, unavailable, pendingId, error, onAction }: { items: readonly PublicAgentActionProposal[]; unavailable: boolean; pendingId: string | null; error: string | null; onAction: (id: string, operation: "confirm" | "cancel") => Promise<void> }) {
  if (unavailable) return <PanelEmpty title="Действия отключены" detail="Включение L2-действий контролируется отдельным feature flag и kill switch." />;
  if (items.length === 0) return <PanelEmpty title="Предложений действий нет" detail="Агент не выполняет изменения без отдельного предложения и явного подтверждения." />;
  return <div className="space-y-3"><PanelTitle title="Подтверждаемые действия" detail="Перед выполнением права и состояние объекта проверяются повторно" />{error ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</p> : null}{items.map((item) => <article key={item.id} className="rounded-lg border border-slate-200 p-3"><div className="flex items-start justify-between gap-3"><h3 className="text-sm font-semibold">{item.summary}</h3><StatusBadge>{actionStatusLabel(item.status)}</StatusBadge></div><ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">{item.consequences.map((consequence) => <li key={consequence}>{consequence}</li>)}</ul>{item.result?.link ? <Link href={item.result.link} className="focus-ring mt-3 inline-flex text-xs font-semibold text-teal-800 underline underline-offset-4">Открыть результат</Link> : null}{item.status === "PROPOSED" ? <div className="mt-3 flex gap-2"><button type="button" disabled={pendingId !== null} onClick={() => void onAction(item.id, "confirm")} className="focus-ring rounded-md bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50">Подтвердить</button><button type="button" disabled={pendingId !== null} onClick={() => void onAction(item.id, "cancel")} className="focus-ring rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Отменить</button></div> : null}<p className="mt-2 text-[11px] text-slate-500">Действительно до {formatDateTime(item.expiresAt)}</p></article>)}</div>;
}

function PanelTitle({ title, detail }: { title: string; detail: string }) { return <header><h2 className="font-semibold text-slate-950">{title}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p></header>; }
function PanelLoading() { return <div role="status" className="py-16 text-center text-sm text-slate-500">Загружаю защищённые рабочие данные…</div>; }
function PanelEmpty({ title, detail }: { title: string; detail: string }) { return <div className="py-14 text-center"><h2 className="font-semibold text-slate-900">{title}</h2><p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-slate-500">{detail}</p></div>; }
function StatusBadge({ children }: { children: React.ReactNode }) { return <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">{children}</span>; }
function RiskBadge({ level }: { level: PublicAgentProactiveInsight["level"] }) { const label = { LOW: "Низкий", MEDIUM: "Средний", HIGH: "Высокий", CRITICAL: "Критический" }[level]; const style = level === "CRITICAL" || level === "HIGH" ? "bg-rose-50 text-rose-800" : level === "MEDIUM" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700"; return <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${style}`}>{label}</span>; }

async function loadWorkspaceData(): Promise<WorkspaceData> {
  const requests = await Promise.allSettled([
    apiJson<{ items: PublicAgentCase[] }>("/api/agent/cases"),
    apiJson<WeeklyDigest>("/api/agent/digest?timezone=Europe%2FMoscow"),
    apiJson<{ items: PublicAgentProactiveInsight[] }>("/api/agent/insights"),
    apiJson<{ items: PublicAgentActionProposal[] }>("/api/agent/actions"),
  ]);
  const unavailable = new Set<WorkspacePanel>();
  if (requests[0].status === "rejected") unavailable.add("CASES");
  if (requests[1].status === "rejected") unavailable.add("DIGEST");
  if (requests[2].status === "rejected") unavailable.add("INSIGHTS");
  if (requests[3].status === "rejected") unavailable.add("ACTIONS");
  return {
    cases: requests[0].status === "fulfilled" ? requests[0].value.items : [],
    digest: requests[1].status === "fulfilled" ? requests[1].value : null,
    insights: requests[2].status === "fulfilled" ? requests[2].value.items : [],
    actions: requests[3].status === "fulfilled" ? requests[3].value.items : [],
    unavailable,
  };
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? "Не удалось получить данные МТР-агента");
  return payload;
}

function selectClassName() { return "focus-ring block h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-800 disabled:bg-slate-100"; }
function dateInputValue(value: string) { return value.slice(0, 10); }
function startOfDay(value: string) { return `${value}T00:00:00.000Z`; }
function endOfDay(value: string) { return `${value}T23:59:59.999Z`; }
function formatDateTime(value: string) { return Number.isFinite(Date.parse(value)) ? DATE_FORMAT.format(new Date(value)) : "дата не указана"; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Не удалось выполнить действие"; }
function caseStatusLabel(value: PublicAgentCase["status"]) { return { DRAFT: "Черновик", GATHERING_DATA: "Собирает данные", ANALYZED: "Проанализирован", NEEDS_REVIEW: "Нужна проверка", READY: "Готов", BLOCKED: "Заблокирован", CLOSED: "Закрыт" }[value]; }
function digestStatusLabel(value: WeeklyDigest["status"]) { return { COMPLETE: "Полная", PARTIAL: "Частичная", UNAVAILABLE: "Недоступна" }[value]; }
function digestMetricLabel(value: WeeklyDigest["comparison"][number]["key"]) { return { SPECIFICATIONS: "Спецификации", POSITIONS: "Позиции", KPI: "KPI", TASKS: "Задания" }[value]; }
function taskStatusLabel(value: WeeklyDigest["sections"]["tasks"][number]["status"]) { return { AWAITING_ACCEPTANCE: "Ожидает принятия", IN_PROGRESS: "В работе", REQUIRES_DECISION: "Требует решения", RETURNED_FOR_CLARIFICATION: "Возвращено на уточнение", COMPLETED: "Завершено", CANCELLED: "Отменено" }[value]; }
function actionStatusLabel(value: PublicAgentActionProposal["status"]) { return { PROPOSED: "Ожидает подтверждения", EXECUTING: "Выполняется", SUCCEEDED: "Выполнено", FAILED: "Ошибка", EXPIRED: "Истекло", CANCELLED: "Отменено" }[value]; }

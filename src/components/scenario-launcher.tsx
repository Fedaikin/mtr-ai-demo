"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { ScenarioRun, Specification } from "@/domain/models";
import { formatDateTime, formatDuration } from "@/lib/format";
import { localizeKnownEnum, runStatusLabel, stepOutcomeLabel } from "@/lib/localization";

interface ScenarioOption {
  id: string;
  name: string;
  description: string;
  defaultSpecificationId?: string;
  defaultSeed?: string;
}

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
const POLL_INTERVAL_MS = 200;

export function ScenarioLauncher({
  scenarios,
  specifications,
}: {
  scenarios: ScenarioOption[];
  specifications: Specification[];
}) {
  const router = useRouter();
  const [scenarioId, setScenarioId] = useState(scenarios[0]?.id ?? "");
  const [specificationId, setSpecificationId] = useState("ALL_CURRENT_SPECIFICATIONS");
  const [mode, setMode] = useState<"NORMAL" | "DRY_RUN">("NORMAL");
  const [run, setRun] = useState<ScenarioRun | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [observing, setObserving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);
  const pollAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => stopObserving(false), []);

  async function launch() {
    stopObserving();
    setActionBusy(true);
    setError(null);
    let created: ScenarioRun | null = null;
    try {
      const selected = scenarios.find((item) => item.id === scenarioId);
      created = await requestRun("/api/scenario-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId,
          specificationId,
          mode,
          seed: selected?.defaultSeed ?? "BASE",
        }),
      });
      setRun(created);
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setActionBusy(false);
    }
    if (created) startObserving(created);
  }

  function startObserving(initial: ScenarioRun) {
    stopObserving();
    stopRef.current = false;
    const controller = new AbortController();
    pollAbortRef.current = controller;
    void observe(initial, controller);
  }

  async function observe(initial: ScenarioRun, controller: AbortController) {
    setObserving(true);
    let current = initial;
    try {
      while (!TERMINAL.has(current.status) && !stopRef.current) {
        await pollDelay(POLL_INTERVAL_MS, controller.signal);
        current = await requestRun(`/api/scenario-runs/${encodeURIComponent(current.id)}`, {
          signal: controller.signal,
        });
        if (!stopRef.current) setRun(current);
      }
      if (!stopRef.current && TERMINAL.has(current.status)) router.refresh();
    } catch (cause) {
      if (!isAbortError(cause)) setError(errorMessage(cause));
    } finally {
      if (pollAbortRef.current === controller) {
        pollAbortRef.current = null;
        setObserving(false);
      }
    }
  }

  function stopObserving(updateState = true) {
    stopRef.current = true;
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
    if (updateState) setObserving(false);
  }

  async function cancel() {
    if (!run) return;
    stopObserving();
    setActionBusy(true);
    try {
      const cancelled = await requestRun(`/api/scenario-runs/${encodeURIComponent(run.id)}/cancel`, {
        method: "POST",
      });
      setRun(cancelled);
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setActionBusy(false);
    }
  }

  async function retry() {
    if (!run) return;
    stopObserving();
    setActionBusy(true);
    setError(null);
    let retried: ScenarioRun | null = null;
    try {
      retried = await requestRun(`/api/scenario-runs/${encodeURIComponent(run.id)}/retry`, {
        method: "POST",
      });
      setRun(retried);
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setActionBusy(false);
    }
    if (retried) startObserving(retried);
  }

  const selectedScenario = scenarios.find((item) => item.id === scenarioId);
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="launch-title">
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-teal-700">Новый запуск</p>
          <h2 id="launch-title" className="mt-1 text-lg font-semibold">Параметры моделирования</h2>
          <p className="mt-2 text-sm leading-5 text-slate-600">Сервер сохранит входной snapshot и журнал каждого шага.</p>
        </div>
        <div className="space-y-4">
          <Field label="Сценарий" htmlFor="scenario-id">
            <select
              id="scenario-id"
              value={scenarioId}
              onChange={(event) => {
                const id = event.target.value;
                const option = scenarios.find((item) => item.id === id);
                setScenarioId(id);
                setSpecificationId(option?.defaultSpecificationId ?? "ALL_CURRENT_SPECIFICATIONS");
              }}
              className="focus-ring h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
            >
              {scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}
            </select>
          </Field>
          {selectedScenario ? <p className="-mt-2 text-xs leading-5 text-slate-500">{selectedScenario.description}</p> : null}
          <Field label="Спецификация" htmlFor="specification-id">
            <select
              id="specification-id"
              value={specificationId}
              onChange={(event) => setSpecificationId(event.target.value)}
              className="focus-ring h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
            >
              <option value="ALL_CURRENT_SPECIFICATIONS">Все актуальные · 24 позиции</option>
              {specifications.map((specification) => (
                <option key={specification.id} value={specification.id}>
                  {specification.projectCode} · {specification.positionCount} поз.
                </option>
              ))}
            </select>
          </Field>
          <Field label="Режим" htmlFor="run-mode">
            <select
              id="run-mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as "NORMAL" | "DRY_RUN")}
              className="focus-ring h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
            >
              <option value="NORMAL">Обычный режим</option>
              <option value="DRY_RUN">Проверочный запуск</option>
            </select>
          </Field>
        </div>
        <button
          type="button"
          onClick={launch}
          disabled={actionBusy || observing || !scenarioId}
          data-testid="launch-scenario"
          className="focus-ring mt-6 inline-flex h-10 w-full items-center justify-center rounded-md bg-teal-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {actionBusy && !run ? "Создание запуска…" : "Запустить сценарий"}
        </button>
      </section>

      <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="run-state-title">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Состояние запуска</p>
            <h2 id="run-state-title" className="mt-1 text-lg font-semibold" aria-live="polite">
              {run ? runStatusLabel(run.status) : "Готов к запуску"}
            </h2>
          </div>
          {run ? <span className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-[11px] text-slate-600">{run.id.slice(-8)}</span> : null}
        </div>
        {run ? (
          <>
            <div className="mt-5" aria-label={`Прогресс ${run.progress}%`}>
              <div className="mb-2 flex justify-between text-xs text-slate-500"><span>{localizeKnownEnum(run.currentStep)}</span><span>{run.progress}%</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-teal-600 transition-[width] duration-150" style={{ width: `${run.progress}%` }} />
              </div>
            </div>
            {run.errorMessage ? (
              <div role="alert" className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                <p className="font-medium">{run.errorMessage}</p>
                <p className="mt-1 text-xs">Рекомендуется ручной импорт или повтор запуска. Технические сведения сохранены в журнале аудита.</p>
              </div>
            ) : null}
            <div className="mt-5 max-h-[360px] overflow-auto rounded-md border border-slate-200" aria-label="Журнал шагов">
              {run.steps.length ? run.steps.map((step) => (
                <div key={step.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-slate-100 px-3 py-2.5 last:border-b-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{step.label}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{formatDateTime(step.startedAt)} · {formatDuration(step.durationMs)}</p>
                  </div>
                  <span className={`text-xs font-medium ${step.outcome === "FAILED" ? "text-rose-700" : step.outcome === "COMPLETED" ? "text-emerald-700" : "text-blue-700"}`}>
                    {stepOutcomeLabel(step.outcome)}
                  </span>
                </div>
              )) : <p className="p-4 text-sm text-slate-500">Запуск поставлен в очередь.</p>}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {!TERMINAL.has(run.status) ? (
                <button type="button" onClick={cancel} disabled={actionBusy} className="focus-ring rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50">Отменить</button>
              ) : null}
              {run.status === "FAILED" || run.status === "CANCELLED" ? (
                <button type="button" onClick={retry} disabled={actionBusy || observing} className="focus-ring rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50">Повторить</button>
              ) : null}
              <Link href={`/runs/${run.id}`} className="focus-ring rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50">Открыть запуск</Link>
              {run.status === "COMPLETED" ? (
                <Link href={`/reports/${run.id}`} className="focus-ring rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800">Открыть отчёт</Link>
              ) : null}
            </div>
            {observing ? <p className="mt-3 text-xs text-slate-500" aria-live="polite">Сервер выполняет сценарий; страница только обновляет сохранённый прогресс…</p> : null}
          </>
        ) : (
          <div className="mt-6 rounded-md border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
            <p className="text-sm font-medium text-slate-700">Здесь появится сохранённый прогресс</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">Шаги выполняются сервером и остаются доступными после обновления или закрытия страницы.</p>
          </div>
        )}
        {error ? <p role="alert" className="mt-4 text-sm text-rose-700">{error}</p> : null}
      </section>
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return <div><label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>{children}</div>;
}

async function requestRun(url: string, init?: RequestInit): Promise<ScenarioRun> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const payload = await response.json().catch(() => null) as { error?: { message?: string } } | ScenarioRun | null;
  if (!response.ok) throw new HttpError(response.status, payload && "error" in payload ? payload.error?.message ?? "Ошибка запроса" : "Ошибка запроса");
  return payload as ScenarioRun;
}

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Не удалось выполнить операцию"; }
function pollDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abortError = () => new DOMException("Опрос остановлен", "AbortError");
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(abortError());
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
function isAbortError(error: unknown): boolean { return error instanceof DOMException && error.name === "AbortError"; }

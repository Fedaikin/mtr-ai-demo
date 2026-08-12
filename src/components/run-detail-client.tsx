"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { ScenarioRun } from "@/domain/models";
import { formatDateTime, formatDuration } from "@/lib/format";
import {
  localizeKnownEnum,
  runStatusLabel,
  scenarioLabel,
  stepOutcomeLabel,
} from "@/lib/localization";

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
const POLL_INTERVAL_MS = 200;

export function RunDetailClient({ initialRun }: { initialRun: ScenarioRun }) {
  const router = useRouter();
  const [run, setRun] = useState(initialRun);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [observing, setObserving] = useState(false);
  const stoppedRef = useRef(false);
  const pollAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (TERMINAL.has(initialRun.status)) return;
    startObserving(initialRun);
    return () => stopObserving(false);
    // A run id is immutable; observing must start once per opened run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRun.id]);

  function startObserving(initial: ScenarioRun) {
    stopObserving();
    stoppedRef.current = false;
    const controller = new AbortController();
    pollAbortRef.current = controller;
    void observe(initial, controller);
  }

  async function observe(initial: ScenarioRun, controller: AbortController) {
    setObserving(true);
    let current = initial;
    try {
      while (!TERMINAL.has(current.status) && !stoppedRef.current) {
        await pollDelay(POLL_INTERVAL_MS, controller.signal);
        current = await getRun(current.id, controller.signal);
        if (!stoppedRef.current) setRun(current);
      }
      if (!stoppedRef.current && TERMINAL.has(current.status)) router.refresh();
    } catch (cause) {
      if (!isAbortError(cause)) setError(messageOf(cause));
    } finally {
      if (pollAbortRef.current === controller) {
        pollAbortRef.current = null;
        setObserving(false);
      }
    }
  }

  function stopObserving(updateState = true) {
    stoppedRef.current = true;
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
    if (updateState) setObserving(false);
  }

  async function cancel() {
    stopObserving();
    setActionBusy(true);
    setError(null);
    try {
      setRun(await parseRunResponse(await fetch(`/api/scenario-runs/${encodeURIComponent(run.id)}/cancel`, { method: "POST" })));
      router.refresh();
    } catch (cause) { setError(messageOf(cause)); } finally { setActionBusy(false); }
  }

  async function retry() {
    stopObserving();
    setActionBusy(true);
    setError(null);
    let retried: ScenarioRun | null = null;
    try {
      retried = await parseRunResponse(await fetch(`/api/scenario-runs/${encodeURIComponent(run.id)}/retry`, { method: "POST" }));
      setRun(retried);
      router.refresh();
    } catch (cause) { setError(messageOf(cause)); } finally { setActionBusy(false); }
    if (retried) startObserving(retried);
  }

  async function importSource(file: File, source: "APPIUS" | "SAP") {
    stopObserving();
    setActionBusy(true);
    setError(null);
    let resumed: ScenarioRun | null = null;
    try {
      const form = new FormData();
      form.set("purpose", `${source}_MANUAL_IMPORT`);
      form.set("file", file);
      const uploadResponse = await fetch("/api/uploads", { method: "POST", body: form });
      const upload = await parsePayload(uploadResponse) as { id: string };
      const validationPath = source === "SAP" ? "sap" : "specification";
      await parsePayload(await fetch(`/api/manual-imports/${validationPath}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uploadedFileId: upload.id }) }));
      resumed = await parseRunResponse(await fetch(`/api/scenario-runs/${encodeURIComponent(run.id)}/manual-import`, {
        method: "POST",
        headers: { "content-type": "application/json", "if-match": String(run.version) },
        body: JSON.stringify({ uploadedFileId: upload.id }),
      }));
      setRun(resumed);
      router.refresh();
    } catch (cause) { setError(messageOf(cause)); } finally { setActionBusy(false); }
    if (resumed) startObserving(resumed);
  }

  const input = run.inputSnapshot;
  const fallbackSource = manualImportSource(run.errorCode);
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
      <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-teal-700">{scenarioLabel(run.scenarioId)}</p><h2 className="mt-1 text-xl font-semibold">{runStatusLabel(run.status)}</h2></div>
          <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-xs text-slate-600">v{run.version}</span>
        </div>
        <div className="mt-5">
          <div className="mb-2 flex justify-between text-xs text-slate-500"><span>{localizeKnownEnum(run.currentStep)}</span><span>{run.progress}%</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-teal-600 transition-[width] duration-150" style={{ width: `${run.progress}%` }} /></div>
        </div>
        {run.errorMessage ? (
          <div role="alert" className="mt-5 rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            <p className="font-semibold">{run.errorMessage}</p><p className="mt-1 text-xs">Технические сведения сохранены в безопасном журнале аудита.</p>
          </div>
        ) : null}
        {fallbackSource ? <ManualSourceImport busy={actionBusy || observing} source={fallbackSource} onFile={importSource} /> : null}
        <div className="mt-5 overflow-hidden rounded-md border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Журнал шагов</div>
          {run.steps.map((step) => (
            <div key={step.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-slate-100 px-3 py-3 last:border-b-0">
              <div><p className="text-sm font-medium">{step.label}</p><p className="mt-1 text-xs text-slate-500">{formatDateTime(step.startedAt)} · {formatDuration(step.durationMs)}</p></div>
              <span className={`text-xs font-semibold ${step.outcome === "FAILED" ? "text-rose-700" : step.outcome === "COMPLETED" ? "text-emerald-700" : "text-blue-700"}`}>{stepOutcomeLabel(step.outcome)}</span>
            </div>
          ))}
          {run.steps.length === 0 ? <p className="p-4 text-sm text-slate-500">Шаги ещё не выполнялись.</p> : null}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {!TERMINAL.has(run.status) ? <button type="button" onClick={cancel} disabled={actionBusy} className="focus-ring rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50">Отменить</button> : null}
          {run.status === "FAILED" || run.status === "CANCELLED" ? <button type="button" onClick={retry} disabled={actionBusy || observing} className="focus-ring rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50">Повторить</button> : null}
          {run.status === "COMPLETED" ? <Link href={`/reports/${run.id}`} className="focus-ring rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800">Открыть отчёт</Link> : null}
        </div>
        {observing ? <p className="mt-3 text-xs text-slate-500" aria-live="polite">Сервер выполняет сценарий; страница только обновляет сохранённый прогресс…</p> : null}
        {error ? <p className="mt-3 text-sm text-rose-700" role="alert">{error}</p> : null}
      </section>
      <aside className="space-y-4">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Входные данные</p><dl className="mt-4 space-y-3 text-sm"><Row name="Созданы" value={formatDateTime(String(input.capturedAt ?? run.createdAt))} /><Row name="Область" value={localizeKnownEnum(String(input.specificationScope ?? "SINGLE"))} /><Row name="Версии" value={localizeKnownEnum(String(input.versionResolutionPolicy ?? "LATEST"))} /><Row name="Режим" value={localizeKnownEnum(run.mode)} /><Row name="Набор данных" value={localizeKnownEnum(run.seed)} /></dl></section>
        <section className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-xs leading-5 text-teal-950"><p className="font-semibold">Синтетические данные</p><p className="mt-1">Запуск относится только к Демо-пользователю. Источники Appius, SAP и нормативов — управляемые моки.</p></section>
      </aside>
    </div>
  );
}

function ManualSourceImport({ busy, source, onFile }: { busy: boolean; source: "APPIUS" | "SAP"; onFile: (file: File, source: "APPIUS" | "SAP") => Promise<void> }) {
  const sourceLabel = source === "SAP" ? "остатков SAP" : "спецификации Appius";
  const formats = source === "APPIUS"
    ? "CSV, XLS, XLSX, TXT, PDF, DOCX, JPEG, JPG, PNG или TIFF"
    : "CSV, XLS или XLSX";
  const accept = source === "APPIUS"
    ? ".csv,.xls,.xlsx,.txt,.pdf,.docx,.jpeg,.jpg,.png,.tiff"
    : ".csv,.xls,.xlsx";
  return <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-semibold text-amber-950">Продолжить через ручной импорт</p><p className="mt-1 text-xs leading-5 text-amber-900">Загрузите {formats} с данными {sourceLabel} до 10 МБ. Строки файла будут канонизированы и станут snapshot этого запуска.{source === "APPIUS" ? " Неизвестный скан будет направлен на ручную проверку." : ""}</p><input type="file" accept={accept} disabled={busy} aria-label={`Файл ${sourceLabel}`} className="mt-3 block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-amber-900 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onFile(file, source); }} /></div>;
}

function Row({ name, value }: { name: string; value: string }) { return <div className="flex justify-between gap-4"><dt className="text-slate-500">{name}</dt><dd className="text-right font-medium text-slate-800">{value}</dd></div>; }
async function getRun(id: string, signal: AbortSignal) { return parseRunResponse(await fetch(`/api/scenario-runs/${encodeURIComponent(id)}`, { cache: "no-store", signal })); }
async function parseRunResponse(response: Response): Promise<ScenarioRun> { return parsePayload(response) as Promise<ScenarioRun>; }
async function parsePayload(response: Response): Promise<unknown> { const body = await response.json().catch(() => null) as { error?: { message?: string } } | null; if (!response.ok) throw new Error(body?.error?.message ?? "Не удалось выполнить запрос"); return body; }
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
function messageOf(value: unknown) { return value instanceof Error ? value.message : "Не удалось выполнить операцию"; }
function manualImportSource(errorCode?: string): "APPIUS" | "SAP" | undefined {
  if (["SAP_UNAVAILABLE", "SAP_RATE_LIMITED", "SAP_MALFORMED_RESPONSE"].includes(errorCode ?? "")) return "SAP";
  if (["APPIUS_UNAVAILABLE", "APPIUS_STALE_VERSION"].includes(errorCode ?? "")) return "APPIUS";
  return undefined;
}

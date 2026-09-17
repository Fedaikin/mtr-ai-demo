"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const sections = [
  { href: "#responsibility", number: "01", title: "Ответственность по позициям" },
  { href: "#doublechecker", number: "02", title: "Даблчекер МТР" },
  { href: "#full-report", number: "03", title: "Полный отчет" },
] as const;

export function MtrAnalysisActions({ runId, canClear }: { runId: string; canClear: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function clearAnalysis() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/mtr-analysis/clear", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось очистить предыдущий анализ");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось очистить предыдущий анализ");
      setBusy(false);
    }
  }

  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <nav aria-label="Подразделы МТР-анализа" className="flex flex-wrap gap-2">
        {sections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            aria-label={`${section.number} ${section.title}`}
            className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:border-teal-300 hover:bg-teal-50/50"
          >
            <span className="text-xs font-bold tabular-nums text-teal-700">{section.number}</span>
            <span>{section.title}</span>
          </Link>
        ))}
      </nav>

      {canClear ? <div className="flex min-h-10 flex-col items-end gap-2">
        {confirming ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2" role="group" aria-label="Подтверждение очистки анализа">
            <p className="text-sm font-medium text-slate-800">Скрыть предыдущий анализ с этого экрана?</p>
            <p className="mt-0.5 text-xs text-slate-600">Результаты останутся в истории запусков и аудите.</p>
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="focus-ring rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void clearAnalysis()}
                disabled={busy}
                aria-label="Подтвердить очистку"
                className="focus-ring rounded-md bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-800 disabled:cursor-wait disabled:opacity-60"
              >
                {busy ? "Очищаем…" : "Очистить"}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
            className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800"
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
            Очистить предыдущий анализ
          </button>
        )}
        <p className="max-w-sm text-right text-xs text-rose-700" aria-live="polite">{error}</p>
      </div> : null}
    </div>
  );
}

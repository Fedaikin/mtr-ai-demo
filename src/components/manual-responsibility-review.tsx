"use client";

import { useState, type FormEvent } from "react";

import type { PositionAnalysisResult } from "@/domain/models";
import { responsibilityLabel } from "@/lib/localization";

export function ManualResponsibilityReview({
  runId,
  result,
}: {
  runId: string;
  result: PositionAnalysisResult;
}) {
  const [responsibility, setResponsibility] = useState<"CUSTOMER" | "CONTRACTOR">(
    result.responsibility === "CUSTOMER" ? "CONTRACTOR" : "CUSTOMER",
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/reports/${encodeURIComponent(runId)}/results/${encodeURIComponent(result.position.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            responsibility,
            reason,
            ...(result.analysisVersion ? { expectedVersion: result.analysisVersion } : {}),
          }),
        },
      );
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "Не удалось сохранить решение эксперта.");
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить решение эксперта.");
      setBusy(false);
    }
  }

  return (
    <section className="rounded-md border border-amber-200 bg-amber-50 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-900">
        Решение эксперта
      </h3>
      <p className="mt-2 text-xs leading-5 text-amber-900/80">
        Изменение сохраняется как новая версия результата. Исходный вывод и причина остаются в аудите.
      </p>
      <form className="mt-3 space-y-3" onSubmit={submit}>
        <label className="block text-xs font-medium text-slate-700">
          Ответственность
          <select
            value={responsibility}
            onChange={(event) => setResponsibility(event.target.value as "CUSTOMER" | "CONTRACTOR")}
            className="focus-ring mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
          >
            <option value="CUSTOMER">Заказчик</option>
            <option value="CONTRACTOR">Подрядчик</option>
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-700">
          Причина (не менее 10 символов)
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            minLength={10}
            maxLength={500}
            rows={3}
            className="focus-ring mt-1 w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        {error ? <p role="alert" className="text-xs text-rose-700">{error}</p> : null}
        <button
          type="submit"
          disabled={busy || reason.trim().length < 10}
          className="focus-ring rounded-md bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Сохранение…" : "Сохранить решение"}
        </button>
      </form>
      {result.manualResponsibilityOverrides?.length ? (
        <div className="mt-4 border-t border-amber-200 pt-3">
          <p className="text-xs font-semibold text-amber-900">История решений</p>
          <ul className="mt-2 space-y-2 text-xs text-amber-950/80">
            {result.manualResponsibilityOverrides.map((override, index) => (
              <li key={`${override.occurredAt}-${index}`}>
                {responsibilityLabel(override.before)} → {responsibilityLabel(override.after)}: {override.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

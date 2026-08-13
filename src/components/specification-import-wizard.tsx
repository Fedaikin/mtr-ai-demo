"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Specification } from "@/domain/models";
import { validateSpecificationImport } from "@/application/specification-import";

type PreviewRow = Record<string, unknown>;
interface UploadResult { id: string; parseStatus: string; normalizedData?: { rows?: PreviewRow[]; rowCount?: number; warnings?: string[] }; warnings?: string[] }

export function SpecificationImportWizard({ specifications }: { specifications: Specification[] }) {
  const router = useRouter();
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"NEW" | "NEW_VERSION">("NEW");
  const [projectCode, setProjectCode] = useState("");
  const [name, setName] = useState("");
  const [specificationId, setSpecificationId] = useState(specifications[0]?.id ?? "");
  const rows = upload?.normalizedData?.rows ?? [];
  const warnings = upload?.warnings ?? upload?.normalizedData?.warnings ?? [];
  const validation = upload?.normalizedData ? validateSpecificationImport(upload.normalizedData) : null;
  const manualReviewCount = upload && upload.parseStatus !== "PARSED" ? Math.max(rows.length, 1) : 0;
  const ready = upload?.parseStatus === "PARSED" && (validation?.validRows ?? 0) > 0 && validation?.errors.length === 0;

  async function onUpload(formData: FormData) {
    setBusy(true); setError(""); setUpload(null);
    formData.set("purpose", "SPECIFICATION_IMPORT");
    try {
      const response = await fetch("/api/uploads", { method: "POST", body: formData });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? body.message ?? "Не удалось загрузить файл");
      setUpload(body);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось загрузить файл"); }
    finally { setBusy(false); }
  }

  async function publish() {
    if (!upload) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/specifications/import/publish", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileId: upload.id, mode, projectCode, name, specificationId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? body.message ?? "Не удалось опубликовать спецификацию");
      setUpload(null); setProjectCode(""); setName(""); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось опубликовать спецификацию"); }
    finally { setBusy(false); }
  }

  async function cancel() {
    if (!upload) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/uploads/${encodeURIComponent(upload.id)}`, { method: "DELETE" });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error?.message ?? "Не удалось отменить загрузку"); }
      setUpload(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось отменить загрузку"); }
    finally { setBusy(false); }
  }

  return <section className="mb-6 rounded-xl border border-teal-200 bg-white p-5 shadow-sm" aria-labelledby="spec-import-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="spec-import-title" className="text-base font-semibold text-slate-950">Загрузить спецификацию</h2><p className="mt-1 text-sm text-slate-600">XLSX, XLS, CSV, TXT, PDF, DOCX или скан до 10 МБ. Перед публикацией покажем распознанные строки.</p></div>
      <form action={onUpload}><label className="focus-within:ring-2 focus-within:ring-teal-500 inline-flex cursor-pointer rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"><span>{busy ? "Обработка…" : "Выбрать файл"}</span><input className="sr-only" type="file" name="file" disabled={busy} accept=".xlsx,.xls,.csv,.txt,.pdf,.docx,.png,.jpg,.jpeg,.tiff" onChange={(event) => event.currentTarget.form?.requestSubmit()} /></label></form>
    </div>
    {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {upload && <div className="mt-5 space-y-4">
      <div className="grid gap-3 sm:grid-cols-3"><Counter label="Готово к сохранению" value={validation?.validRows ?? 0} /><Counter label="Требует исправления" value={validation?.invalidRows ?? 0} /><Counter label="Требует ручной проверки" value={manualReviewCount} /></div>
      {warnings.map((warning) => <p key={warning} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{warning}</p>)}
      {validation?.errors.map((item) => <p key={`${item.row}-${item.message}`} className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{item.row > 0 ? `Строка ${item.row}: ` : ""}{item.message}</p>)}
      {rows.length > 0 && <div className="data-table-scroll max-h-80 overflow-auto rounded-lg border border-slate-200"><table className="w-full min-w-[760px] text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Код</th><th className="px-3 py-2">Наименование</th><th className="px-3 py-2">Количество</th><th className="px-3 py-2">Ед.</th><th className="px-3 py-2">Характеристики</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.slice(0, 100).map((row, index) => <tr key={index}><td className="px-3 py-2 font-mono text-xs">{pick(row, ["internalCode", "code", "Код", "Код позиции"])}</td><td className="px-3 py-2">{pick(row, ["nameRu", "name", "Наименование", "Название"])}</td><td className="px-3 py-2">{pick(row, ["requiredQuantity", "quantity", "Количество"])}</td><td className="px-3 py-2">{pick(row, ["unit", "uom", "Единица", "Ед. изм."])}</td><td className="px-3 py-2 text-xs text-slate-500">{Object.entries(row).filter(([key]) => !["internalCode","code","Код","nameRu","name","Наименование","requiredQuantity","quantity","Количество","unit","uom","Единица"].includes(key)).slice(0, 3).map(([key,value]) => `${key}: ${String(value)}`).join(" · ") || "—"}</td></tr>)}</tbody></table></div>}
      {!ready && <button type="button" disabled={busy} onClick={cancel} className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-50">Отменить загрузку</button>}
      {ready && <div className="grid gap-3 rounded-lg bg-slate-50 p-4 md:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">Действие<select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"><option value="NEW">Создать спецификацию</option><option value="NEW_VERSION">Создать новую версию</option></select></label>
        {mode === "NEW_VERSION" ? <label className="text-sm font-medium text-slate-700">Спецификация<select value={specificationId} onChange={(event) => setSpecificationId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">{specifications.map((specification) => <option key={specification.id} value={specification.id}>{specification.projectCode} · {specification.name}</option>)}</select></label> : <><label className="text-sm font-medium text-slate-700">Код проекта<input required value={projectCode} onChange={(event) => setProjectCode(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label><label className="text-sm font-medium text-slate-700">Название<input required value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label></>}
        <div className="flex items-end gap-2"><button type="button" onClick={publish} disabled={busy || (mode === "NEW" && (!projectCode.trim() || !name.trim())) || (mode === "NEW_VERSION" && !specificationId)} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">Опубликовать</button><button type="button" disabled={busy} onClick={cancel} className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-50">Отмена</button></div>
      </div>}
    </div>}
  </section>;
}

function Counter({ label, value }: { label: string; value: string | number }) { return <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-semibold text-slate-950">{value}</p></div>; }
function pick(row: PreviewRow, keys: string[]) { for (const key of keys) if (row[key] !== undefined && row[key] !== "") return String(row[key]); return "—"; }

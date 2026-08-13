import Link from "next/link";
import type { Metadata } from "next";
import { getRepository } from "@/adapters/persistence/repository";
import { PageHeader } from "@/components/page-header";
import { formatDateTime } from "@/lib/format";
import { requireDemoRole } from "@/lib/session";

export const metadata: Metadata = { title: "Пульс МТР" };
export const dynamic = "force-dynamic";

export default async function PulsePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const entityType = typeof params.entity === "string" ? params.entity.slice(0, 80) : undefined;
  const outcome = params.outcome === "SUCCESS" || params.outcome === "FAILURE" ? params.outcome : undefined;
  const [{ user }, repository] = await Promise.all([requireDemoRole("USER"), getRepository()]);
  const events = await repository.listAuditLogs(user.id, { entityType, outcome, limit: 100 });
  return <><PageHeader eyebrow="Оперативная лента" title="Пульс МТР" description="Пользовательская лента событий спецификаций, запусков, решений и агента. Показаны только события текущего пользователя." />
    <form className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"><label className="text-xs font-medium text-slate-600">Сущность<input name="entity" defaultValue={entityType} placeholder="specification, scenario_run…" className="mt-1 block rounded-md border border-slate-300 px-3 py-2 text-sm" /></label><label className="text-xs font-medium text-slate-600">Результат<select name="outcome" defaultValue={outcome ?? ""} className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">Все</option><option value="SUCCESS">Успешно</option><option value="FAILURE">Ошибка</option></select></label><button className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white">Применить</button><Link href="/pulse" className="rounded-md border border-slate-300 px-4 py-2 text-sm">Сбросить</Link></form>
    <ol className="space-y-3">{events.map((event) => <li key={event.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-slate-900">{eventLabel(event.action)}</p><time className="text-xs text-slate-500">{formatDateTime(event.occurredAt)}</time></div><p className="mt-2 text-sm text-slate-600">{event.entityType}{event.entityId ? ` · ${event.entityId}` : ""}</p><div className="mt-3 flex flex-wrap gap-2 text-xs"><span className={`rounded-full px-2.5 py-1 ${event.outcome === "SUCCESS" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{event.outcome === "SUCCESS" ? "Успешно" : "Ошибка"}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{event.actorDisplayName}</span></div></li>)}{events.length === 0 && <li className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">По выбранным фильтрам событий нет.</li>}</ol>
  </>;
}
function eventLabel(action: string) { return ({ "FILE_UPLOADED_AND_PARSED": "Файл загружен и распознан", "specification.import.created": "Создана спецификация", "specification.import.version_created": "Создана новая версия", "specification.import.validation_rejected": "Публикация отклонена после проверки", "specification.import.cancelled": "Загрузка отменена пользователем", "agent.response.completed": "Агент подготовил ответ" } as Record<string, string>)[action] ?? "Событие рабочего процесса"; }

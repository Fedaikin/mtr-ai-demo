import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ScenarioService } from "@/application/scenario-service";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { formatDateTime } from "@/lib/format";
import { scenarioLabel } from "@/lib/localization";
import { requireDemoRole } from "@/lib/session";

export const metadata: Metadata = { title: "Мои запуски" };
export const dynamic = "force-dynamic";

export default async function RunsPage() {
  redirect("/admin/scenarios?tab=runs");
}

export async function RunsWorkspace() {
  const [{ user }, service] = await Promise.all([requireDemoRole("USER"), ScenarioService.create()]);
  const runs = await service.listRuns(user.id, { includeSteps: false });
  return (
    <>
      <PageHeader
        eyebrow="Администрирование"
        title="Запуски анализа"
        description="Сохранённые серверные запуски и цепочки повторных попыток собраны вместе со сценариями."
        action={<Link href="/admin/scenarios" className="focus-ring inline-flex rounded-md bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800">Запустить анализ</Link>}
      />
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="data-table-scroll overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Запуск</th><th className="px-4 py-3">Сценарий</th><th className="px-4 py-3">Статус</th><th className="px-4 py-3">Прогресс</th><th className="px-4 py-3">Создан</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {runs.map((run) => (
                <tr key={run.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3"><Link href={`/runs/${run.id}`} className="focus-ring rounded-sm font-mono text-xs font-semibold text-teal-800 hover:underline">{run.id.slice(-12)}</Link>{run.retryOfRunId ? <p className="mt-1 text-[11px] text-slate-500">повтор {run.retryOfRunId.slice(-8)}</p> : null}</td>
                  <td className="px-4 py-3 text-slate-700">{scenarioLabel(run.scenarioId)}</td>
                  <td className="px-4 py-3"><StatusPill status={run.status} /></td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{run.progress}%</td>
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(run.createdAt)}</td>
                </tr>
              ))}
              {runs.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">Запусков пока нет.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

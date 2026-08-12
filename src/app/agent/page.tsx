import type { Metadata } from "next";
import Link from "next/link";

import { getRepository } from "@/adapters/persistence/repository";
import { AgentChat } from "@/components/agent-chat";
import { AnalyticsWorkspace } from "@/components/analytics-workspace";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { formatDateTime, formatNumber } from "@/lib/format";
import { scenarioLabel } from "@/lib/localization";
import { requireDemoRole } from "@/lib/session";

import {
  isUserVisibleAgentMessage,
  serializeAgentMessage,
  serializeAgentThread,
} from "../api/agent/_shared";

export const metadata: Metadata = { title: "МТР-аналитик" };
export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const sessionPromise = requireDemoRole("USER");
  const repositoryPromise = getRepository();
  const [session, repository] = await Promise.all([sessionPromise, repositoryPromise]);
  const [threads, positions, runs, catalogue] = await Promise.all([
    repository.listAgentThreads(session.user.id),
    repository.listPositions(session.user.id, { currentOnly: true }),
    repository.listRuns(session.user.id, { limit: 1, includeSteps: false }),
    repository.searchCatalogItems(session.user.id, { limit: 1, offset: 0 }),
  ]);
  const activeThread = threads[0];
  const messages = activeThread ? await repository.listAgentMessages(session.user.id, activeThread.id) : [];
  const lastRun = runs[0];

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="AI-агент · подтверждённые данные"
        title="МТР-аналитик"
        description="Обзор результатов, актуальные позиции и AI-агент в одной рабочей области."
      />
      <AnalyticsWorkspace
        overview={
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Актуальные позиции" value={formatNumber(positions.length)} hint="Последние версии Appius PLM" />
            <SummaryCard
              label="Промышленный каталог"
              value={formatNumber(catalogue.total)}
              hint="Компоненты, узлы, остатки и семейства замен"
            />
            <SummaryCard
              label="Последний запуск"
              value={lastRun ? formatDateTime(lastRun.createdAt) : "Запусков нет"}
              hint={lastRun ? scenarioLabel(lastRun.scenarioId) : "Запустите анализ в разделе моделирования"}
              status={lastRun ? <StatusPill status={lastRun.status} /> : undefined}
            />
            <div className="rounded-xl border border-teal-200 bg-teal-50 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">Быстрый доступ</p>
              <p className="mt-2 text-sm leading-6 text-teal-950">AI-агент проверяет Appius PLM, SAP S/4HANA, промышленный каталог и демонстрационные нормативные правила.</p>
              {lastRun?.status === "COMPLETED" ? (
                <Link href={`/reports/${lastRun.id}`} className="focus-ring mt-4 inline-flex rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800">
                  Открыть последний отчёт
                </Link>
              ) : null}
            </div>
          </div>
        }
        positions={
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-950">Актуальные позиции</h2>
              <p className="mt-1 text-sm text-slate-500">{formatNumber(positions.length)} позиций текущих версий. Детализация открывается без смены контекста аналитики.</p>
            </div>
            <div className="max-h-[calc(100dvh-22rem)] overflow-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="px-4 py-3">Код</th><th className="px-4 py-3">Позиция</th><th className="px-4 py-3">Количество</th><th className="px-4 py-3">Версия</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {positions.map((position) => (
                    <tr key={position.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-teal-800">{position.internalCode}</td>
                      <td className="px-4 py-3"><p className="font-medium text-slate-900">{position.nameRu}</p><p className="mt-1 text-xs text-slate-500">{position.specificationName}</p></td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{formatNumber(position.requiredQuantity)} {position.unit}</td>
                      <td className="px-4 py-3 text-slate-600">v{position.versionNumber}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        }
        agent={
          <AgentChat
            displayName={session.user.displayName}
            initialThreads={threads.map(serializeAgentThread)}
            initialThreadId={activeThread?.id ?? null}
            initialMessages={messages.filter(isUserVisibleAgentMessage).map(serializeAgentMessage)}
          />
        }
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  status,
}: {
  label: string;
  value: string;
  hint: string;
  status?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        {status}
      </div>
      <p className="mt-3 text-xl font-semibold text-slate-950">{value}</p>
      <p className="mt-2 text-sm leading-5 text-slate-500">{hint}</p>
    </div>
  );
}

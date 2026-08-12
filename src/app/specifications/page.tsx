import type { Metadata } from "next";
import Link from "next/link";

import { AppiusMockError, createAppiusMockAdapter } from "@/adapters/mock/appius-adapter";
import { PageHeader } from "@/components/page-header";
import { formatNumber } from "@/lib/format";
import { getDemoSession } from "@/lib/session";

export const metadata: Metadata = { title: "Мои спецификации" };
export const dynamic = "force-dynamic";

export default async function SpecificationsPage() {
  const [adapter, session] = await Promise.all([createAppiusMockAdapter(), getDemoSession()]);

  let loadError: unknown;
  let loaded:
    | {
        specifications: Awaited<ReturnType<typeof adapter.listSpecifications>>;
      }
    | undefined;
  try {
    const specifications = await adapter.listSpecifications(session.user.id);
    loaded = { specifications };
  } catch (error) {
    loadError = error;
  }

  if (!loaded) {
    return (
      <div>
        <PageHeader
          eyebrow="Appius PLM"
          title="Мои спецификации"
          description="Не удалось получить оперативные данные Appius."
        />
        <DataSourceError error={loadError} />
      </div>
    );
  }

  const { specifications } = loaded;
  return (
      <div>
        <PageHeader
          eyebrow="Appius PLM · текущие данные"
          title="Мои спецификации"
          description={`Доступны только данные пользователя «${session.user.displayName}». Для анализа используются актуальные версии.`}
        />

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <p className="text-sm font-medium text-slate-900">
              {formatNumber(specifications.length)} спецификации · 24 актуальные позиции
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Исторические версии доступны для просмотра, но не участвуют в новом анализе.
            </p>
          </div>
          <div className="data-table-scroll overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Проект</th>
                  <th className="px-5 py-3">Спецификация</th>
                  <th className="px-5 py-3">Актуальная версия</th>
                  <th className="px-5 py-3 text-right">Позиций</th>
                  <th className="px-5 py-3"><span className="sr-only">Действие</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {specifications.map((specification) => (
                    <tr key={specification.id} className="text-slate-700 hover:bg-slate-50/70">
                      <td className="whitespace-nowrap px-5 py-4 font-mono text-xs text-slate-600">
                        {specification.projectCode}
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-medium text-slate-950">{specification.name}</p>
                        <p className="mt-1 font-mono text-xs text-slate-500">{specification.id}</p>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4">
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
                          v{specification.latestVersionNumber} · актуальна
                        </span>
                        <p className="mt-2 text-xs text-slate-500">Последняя разрешённая версия</p>
                      </td>
                      <td className="px-5 py-4 text-right font-medium text-slate-950">
                        {formatNumber(specification.positionCount)}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <Link
                          href={`/specifications/${specification.id}`}
                          className="focus-ring inline-flex rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:border-teal-300 hover:text-teal-800"
                        >
                          Открыть
                        </Link>
                      </td>
                    </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
  );
}

function DataSourceError({ error }: { error: unknown }) {
  const message =
    error instanceof AppiusMockError
      ? error.safeMessage
      : "Appius временно недоступен. Повторите запрос позднее.";
  return (
    <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
      <p className="font-semibold">Данные Appius недоступны</p>
      <p className="mt-2 leading-6">{message}</p>
      <p className="mt-3 text-xs text-amber-800">
        Можно продолжить работу через безопасный ручной импорт спецификации в сценарии отказа.
      </p>
    </div>
  );
}

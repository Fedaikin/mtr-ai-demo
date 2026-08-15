import Link from "next/link";

import type {
  PublicAgentAnalysisSummary,
  PublicAgentCommandResult,
  PublicAgentSource,
} from "@/application/agent-orchestrator/public-projection";

export function AgentCommandResult({ result }: { result: PublicAgentCommandResult }) {
  const identity = result.messageId.replace(/[^A-Za-z0-9_-]/gu, "-");
  const titleId = `agent-command-result-${identity}-title`;
  const sourcesTitleId = `agent-command-result-${identity}-sources-title`;

  return (
    <section
      aria-labelledby={titleId}
      aria-live="polite"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      data-testid="agent-command-result"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">
            МТР Агент
          </p>
          <h2 id={titleId} className="mt-1 text-lg font-semibold text-slate-950">
            {result.responseLabel}
          </h2>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
          {result.statusLabel}
        </span>
      </div>

      <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">
        {result.answer}
      </p>

      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-600">
        {result.riskLabel ? (
          <div>
            <dt className="font-medium text-slate-500">Уровень риска</dt>
            <dd className="mt-0.5 font-semibold text-slate-900">{result.riskLabel}</dd>
          </div>
        ) : null}
        {result.confidence !== null ? (
          <div>
            <dt className="font-medium text-slate-500">Уверенность</dt>
            <dd className="mt-0.5 font-semibold text-slate-900">
              {Math.round(result.confidence * 100)}%
            </dd>
          </div>
        ) : null}
      </dl>

      {result.requiresHumanReview ? (
        <p
          role="status"
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900"
        >
          Требуется проверка специалиста
        </p>
      ) : null}

      {result.analysis ? <AnalyticalDetails analysis={result.analysis} /> : null}

      {result.sources.length > 0 ? (
        <section aria-labelledby={sourcesTitleId} className="mt-5 border-t border-slate-100 pt-4">
          <h3 id={sourcesTitleId} className="text-sm font-semibold text-slate-900">
            Источники
          </h3>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {result.sources.map((source, index) => (
              <li key={`${source.sourceLabel}-${source.entityId ?? "revoked"}-${index}`}>
                <SourceCard source={source} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

function AnalyticalDetails({ analysis }: { analysis: PublicAgentAnalysisSummary }) {
  return (
    <section aria-label="Доказательная аналитика" className="mt-5 space-y-4 border-t border-slate-100 pt-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-950">Подтверждённые факты</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {analysis.facts.map((fact) => <li key={fact}>{fact}</li>)}
        </ul>
      </div>

      {analysis.drivers.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-slate-950">Главные факторы</h3>
          <ul className="mt-2 grid gap-2 md:grid-cols-3">
            {analysis.drivers.map((driver) => (
              <li key={`${driver.title}-${driver.status}`} className="rounded-lg bg-slate-50 p-3 text-sm">
                <p className="font-semibold text-slate-900">{driver.title}</p>
                <p className="mt-1 text-slate-600">{driver.relationship} · {driver.contributionPercent}%</p>
                <p className="mt-1 text-xs text-slate-500">{driver.status}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {analysis.forecast ? (
        <details className="rounded-lg border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">
            Прогноз и backtest
          </summary>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-4">
            <Metric label="Горизонт" value={`${analysis.forecast.horizonWeeks} нед.`} />
            <Metric label="MAE" value={formatNumber(analysis.forecast.mae)} />
            <Metric label="WAPE" value={`${formatNumber(analysis.forecast.wapePercent)}%`} />
            <Metric label="Bias" value={formatNumber(analysis.forecast.bias)} />
          </dl>
          <p className="mt-2 break-all text-xs text-slate-500">Модель: {analysis.forecast.model}</p>
        </details>
      ) : null}

      {analysis.scenarios.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-slate-950">Сравнение вариантов</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="px-2 py-1 font-medium">Вариант</th>
                  <th className="px-2 py-1 font-medium">Покрыто</th>
                  <th className="px-2 py-1 font-medium">Дефицит</th>
                  <th className="px-2 py-1 font-medium">Проверка</th>
                </tr>
              </thead>
              <tbody>
                {analysis.scenarios.map((scenario) => (
                  <tr key={`${scenario.kind}-${scenario.score}`} className="border-t border-slate-100">
                    <td className="px-2 py-2 font-medium text-slate-900">{scenario.kind}</td>
                    <td className="px-2 py-2 text-slate-700">{formatNumber(scenario.coveredQuantity)}</td>
                    <td className="px-2 py-2 text-slate-700">{formatNumber(scenario.remainingShortage)}</td>
                    <td className="px-2 py-2 text-slate-700">{scenario.feasible ? "Допустим" : "Отклонён"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {analysis.recommendation ? (
        <p className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-950">
          Следующий шаг: {analysis.recommendation}
        </p>
      ) : null}

      {analysis.limitations.length > 0 ? (
        <details className="text-sm text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-800">Ограничения расчёта</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {analysis.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-slate-500">{label}</dt><dd className="font-semibold text-slate-900">{value}</dd></div>;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

function SourceCard({ source }: { source: PublicAgentSource }) {
  return (
    <article
      aria-label={`Источник: ${source.sourceLabel}`}
      className="h-full rounded-lg border border-slate-200 bg-slate-50 p-3"
    >
      <h4 className="font-semibold text-slate-900">{source.sourceLabel}</h4>
      <dl className="mt-2 space-y-1 text-xs text-slate-600">
        {source.entityId ? <SourceDetail label="Объект" value={source.entityId} /> : null}
        {source.versionOrSnapshot ? (
          <SourceDetail label="Версия или снимок" value={source.versionOrSnapshot} />
        ) : null}
        {source.clauseId ? <SourceDetail label="Пункт" value={source.clauseId} /> : null}
        <SourceDetail label="Актуальность" value={source.freshnessLabel} />
        <SourceDetail label="Доступность" value={source.availabilityLabel} />
      </dl>
      {source.canOpen && source.href ? (
        <Link
          aria-label={`Открыть источник: ${source.sourceLabel}`}
          href={source.href}
          prefetch={false}
          className="mt-3 inline-flex rounded-md font-semibold text-teal-800 underline decoration-teal-300 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
        >
          Открыть источник
        </Link>
      ) : null}
    </article>
  );
}

function SourceDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="break-words text-slate-800">{value}</dd>
    </div>
  );
}

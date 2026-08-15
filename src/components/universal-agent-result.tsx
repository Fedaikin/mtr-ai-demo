import type { PublicUniversalResult } from "@/application/agent-orchestrator/universal-chat/public-projection";

export function UniversalAgentResult({ result }: { result: PublicUniversalResult }) {
  if (result.kind === "CLARIFICATION") {
    return (
      <section data-testid="universal-agent-result" aria-label="Уточнение МТР-агента">
        <p className="text-sm leading-6 text-slate-800">{result.question}</p>
        {result.candidates.length ? (
          <ul className="mt-3 space-y-2 text-xs text-slate-700">
            {result.candidates.map((candidate) => (
              <li key={`${candidate.kindLabel}-${candidate.code}`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="font-semibold text-slate-900">{candidate.name}</span>
                <span className="ml-2 text-slate-500">{candidate.kindLabel} · {candidate.code}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    );
  }

  return (
    <section className="space-y-4" data-testid="universal-agent-result" aria-label="Структурированный ответ МТР-агента">
      <p className="text-sm font-medium leading-6 text-slate-900">{result.summary}</p>
      {result.facts.length ? (
        <dl className="grid gap-2 sm:grid-cols-2">
          {result.facts.map((fact, index) => (
            <div key={`${fact.label}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <dt className="text-[11px] text-slate-500">{fact.label}</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-950">
                {fact.value}{fact.unit ? ` ${fact.unit}` : ""}
                {fact.statusLabel ? <span className="ml-2 text-[10px] font-medium text-slate-500">{fact.statusLabel}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {result.tables.map((table) => (
        <section key={table.title} aria-label={table.title}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{table.title}</h4>
          <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-100 text-slate-600"><tr>{table.columns.map((column) => <th key={column} className="whitespace-nowrap px-3 py-2 font-semibold">{column}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100 bg-white">{table.rows.map((row, rowIndex) => <tr key={rowIndex}>{table.columns.map((column) => <td key={column} className="whitespace-nowrap px-3 py-2 text-slate-700">{row[column] ?? "—"}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {table.totalRows > table.rows.length ? <p className="mt-1 text-[11px] text-slate-500">Показано {table.rows.length} из {table.totalRows}.</p> : null}
        </section>
      ))}
      {result.risks.length ? <CardList title="Риски" items={result.risks.map((risk) => ({ badge: risk.levelLabel, title: risk.title, body: risk.explanation }))} /> : null}
      {result.compatibility.length ? (
        <section aria-label="Варианты совместимости">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Совместимость и покрытие</h4>
          <div className="mt-2 space-y-2">{result.compatibility.map((item) => (
            <article key={`${item.sourceMaterialCode}-${item.candidateMaterialCode}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
              <p className="font-semibold text-slate-950">{item.sourceMaterialCode} → {item.candidateMaterialCode}</p>
              <p className="mt-1 text-slate-700">Техническая совместимость: {item.technicalCompatibilityPercent === null ? "недостаточно данных" : `${item.technicalCompatibilityPercent}%`} · покрытие количества: {item.quantityCoveragePercent}%</p>
              <p className="mt-1 font-medium text-teal-900">{item.verdictLabel}</p>
              {item.deviations.length ? <p className="mt-1 text-slate-600">Отклонения: {item.deviations.join("; ")}</p> : null}
              {item.normativeBasis ? <p className="mt-1 text-slate-600">Основание: {item.normativeBasis}</p> : null}
            </article>
          ))}</div>
        </section>
      ) : null}
      {result.recommendations.length ? <CardList title="Рекомендации" items={result.recommendations.map((item) => ({ badge: item.kindLabel, title: item.title, body: `${item.explanation}${item.quantity === null ? "" : ` Количество: ${item.quantity}${item.unit ? ` ${item.unit}` : ""}.`} Остаточный риск: ${item.residualRisk}` }))} /> : null}
      {result.limitations.length ? <CardList title="Ограничения" items={result.limitations.map((item) => ({ badge: "Нужны данные", title: item.message, body: item.impact }))} /> : null}
    </section>
  );
}

function CardList({ title, items }: { title: string; items: readonly { badge: string; title: string; body: string }[] }) {
  return (
    <section aria-label={title}>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</h4>
      <div className="mt-2 space-y-2">{items.map((item, index) => (
        <article key={`${item.title}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
          <p><span className="mr-2 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600">{item.badge}</span><span className="font-semibold text-slate-950">{item.title}</span></p>
          <p className="mt-1 leading-5 text-slate-700">{item.body}</p>
        </article>
      ))}</div>
    </section>
  );
}

import Link from "next/link";
import type { Metadata } from "next";

import { getRepository } from "@/adapters/persistence/repository";
import { getReport } from "@/application/report-service";
import { AnalysisReviewQueue } from "@/components/analysis-review-queue";
import { PageHeader } from "@/components/page-header";
import { formatDateTime, formatNumber } from "@/lib/format";
import { responsibilityLabel } from "@/lib/localization";
import { requirePermission } from "@/lib/session";

export const metadata: Metadata = { title: "МТР-анализ" };
export const dynamic = "force-dynamic";

export default async function MtrAnalysisPage() {
  const [{ user }, repository] = await Promise.all([requirePermission("report.read"), getRepository()]);
  const [latest] = await repository.listRuns(user.id, {
    status: "COMPLETED",
    limit: 1,
    includeSteps: false,
  });

  if (!latest) {
    return (
      <>
        <PageHeader
          eyebrow="Подтверждённые результаты"
          title="МТР-анализ"
          description="Последний завершённый анализ по актуальной версии спецификации."
        />
        <EmptyState />
      </>
    );
  }

  const { report } = await getReport(user.id, latest.id);
  const records = await repository.listAnalysisResults(user.id, latest.id);
  const reviews = await repository.ensureAnalysisReviews(
    user.id,
    records.map((record) => ({
      resultId: record.id,
      runId: latest.id,
      positionId: record.positionId,
      exact: record.matchCategory === "EXACT" && record.matchScore === 100 && !record.requiresHumanReview,
      agentEvidence: {
        positionCode: resultPositionCode(record.result, record.positionId),
        category: record.matchCategory,
        score: record.matchScore,
        materialCode: record.matchedMaterialCode ?? "—",
        requiresHumanReview: record.requiresHumanReview,
      },
      independentEvidence: {
        rule: "Только EXACT + 100% + отсутствие флага проверки",
        categoryEqual: record.matchCategory === "EXACT",
        scoreEqual100: record.matchScore === 100,
        humanReviewFlagAbsent: !record.requiresHumanReview,
        source: "Сохранённый неизменяемый результат запуска",
      },
    })),
  );
  const decided = report.results.filter(
    (result) => !result.requiresHumanReview && result.responsibilityConfidence === 1,
  );
  const customerRows = decided.filter((result) => result.responsibility === "CUSTOMER");
  const contractorRows = decided.filter((result) => result.responsibility === "CONTRACTOR");
  const reviewRows = report.results.filter((result) => !decided.includes(result));

  return (
    <>
      <PageHeader
        eyebrow="Подтверждённые результаты"
        title="МТР-анализ"
        description={`Последний завершённый отчёт от ${formatDateTime(report.generatedAt)}. Ответственность с неполной уверенностью не считается решением.`}
      />
      <nav aria-label="Подразделы МТР-анализа" className="mb-5 grid gap-3 md:grid-cols-3">
        <SectionLink href="#responsibility" number="01" title="Ответственность по позициям" description="Решение, уверенность и нормативное основание" />
        <SectionLink href="#doublechecker" number="02" title="Даблчекер МТР" description="Независимая проверка и решение эксперта" />
        <SectionLink href="#full-report" number="03" title="Полный отчет" description="Все результаты, источники и выгрузка" />
      </nav>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Metric label="Заказчик" value={`${customerRows.length} поз.`} detail={requiredVolumes(customerRows)} />
        <Metric label="Подрядчик" value={`${contractorRows.length} поз.`} detail={requiredVolumes(contractorRows)} />
        <Metric label="Требуется решение" value={`${reviewRows.length} поз.`} detail={requiredVolumes(reviewRows)} warning />
      </div>
      <section id="responsibility" className="scroll-mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-4">
          <h2 className="font-semibold">Ответственность по позициям</h2>
          <p className="mt-1 text-sm text-slate-500">Источник, версия правила и объяснение доступны для каждой строки; ручные изменения сохраняются в полном отчете.</p>
        </div>
        <div className="data-table-scroll overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-3">Позиция</th><th className="px-4 py-3">Решение</th><th className="px-4 py-3">Уверенность</th><th className="px-4 py-3">Объяснение</th><th className="px-4 py-3">Документ / пункт</th><th className="px-4 py-3">Проверка</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.results.map((result) => {
                const needsDecision = result.requiresHumanReview || result.responsibilityConfidence < 1;
                return (
                  <tr key={result.position.id}>
                    <td className="px-4 py-3"><p className="font-mono text-xs font-semibold text-teal-800">{result.position.internalCode}</p><p className="mt-1 font-medium">{result.position.nameRu}</p></td>
                    <td className={`px-4 py-3 font-medium ${needsDecision ? "text-amber-800" : "text-slate-900"}`}>{needsDecision ? "Требуется решение" : responsibilityLabel(result.responsibility)}</td>
                    <td className="px-4 py-3 tabular-nums">{Math.round(result.responsibilityConfidence * 100)}%</td>
                    <td className="max-w-md px-4 py-3 text-slate-600">{result.responsibilityExplanation ?? "Объяснение не сохранено"}</td>
                    <td className="px-4 py-3 text-xs"><p>{result.responsibilityCitation.title}</p><p className="mt-1 text-slate-500">v{result.responsibilityCitation.version} · {result.responsibilityCitation.clauseId}</p></td>
                    <td className="px-4 py-3 text-xs">{result.manualResponsibilityOverrides?.length ? `Изменено вручную · ${result.manualResponsibilityOverrides.at(-1)?.actor}` : needsDecision ? "В очереди эксперта" : "Подтверждено правилом"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <div id="doublechecker" className="scroll-mt-6"><AnalysisReviewQueue initialReviews={reviews} /></div>
      <section id="full-report" className="mt-6 scroll-mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase text-teal-700">Полный отчет</p>
            <h2 className="mt-1 text-lg font-semibold">Консолидированный результат анализа</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">Все позиции, совпадения, складские остатки, ответственность, объяснения, источники и решения эксперта доступны в полном отчете.</p>
          </div>
          <Link href={`/reports/${latest.id}`} className="focus-ring rounded-md bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800">Открыть полный отчет</Link>
        </div>
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
          <ReportFact label="Позиций" value={String(report.results.length)} />
          <ReportFact label="Решений человека" value={String(reviews.filter((review) => review.decidedBy).length)} />
          <ReportFact label="Сформирован" value={formatDateTime(report.generatedAt)} />
        </dl>
      </section>
    </>
  );
}

function SectionLink({ href, number, title, description }: { href: string; number: string; title: string; description: string }) {
  return <Link href={href} className="focus-ring rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-teal-300 hover:bg-teal-50/40"><span className="text-xs font-semibold text-teal-700">{number}</span><span className="mt-2 block font-semibold text-slate-900">{title}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span></Link>;
}

function Metric({ label, value, detail, warning = false }: { label: string; value: string; detail: string; warning?: boolean }) {
  return <div className={`rounded-xl border p-5 shadow-sm ${warning ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}><p className="text-xs uppercase text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-slate-500">Объём: {detail}</p></div>;
}

function ReportFact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 font-semibold text-slate-900">{value}</dd></div>;
}

function EmptyState() {
  return <section className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center"><h2 className="text-lg font-semibold">Завершённых отчётов пока нет</h2><p className="mt-2 text-sm text-slate-500">Запустите сценарий — после завершения здесь появится актуальный результат.</p><Link href="/admin/scenarios" className="focus-ring mt-5 inline-flex rounded-md bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white">Перейти к сценариям</Link></section>;
}

function resultPositionCode(result: Record<string, unknown>, fallback: string) {
  const position = result.position;
  return position && typeof position === "object" && !Array.isArray(position) && typeof (position as Record<string, unknown>).internalCode === "string" ? String((position as Record<string, unknown>).internalCode) : fallback;
}

function requiredVolumes(rows: Array<{ position: { requiredQuantity: number; unit: string } }>) {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.position.unit, (totals.get(row.position.unit) ?? 0) + row.position.requiredQuantity);
  return [...totals].map(([unit, quantity]) => `${formatNumber(quantity)} ${unit}`).join(" · ") || "0";
}

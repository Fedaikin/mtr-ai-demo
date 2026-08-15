import Link from "next/link";
import type { Metadata } from "next";

import { getRepository } from "@/adapters/persistence/repository";
import { getReport } from "@/application/report-service";
import { AgentOrchestratorWorkspace } from "@/components/agent-orchestrator-workspace";
import { AnalysisReviewQueue } from "@/components/analysis-review-queue";
import { PageHeader } from "@/components/page-header";
import { effectiveResponsibilityDecisionState } from "@/domain/responsibility";
import { formatDateTime, formatNumber } from "@/lib/format";
import { selectLatestCompletedRun } from "@/lib/latest-completed-run";
import { responsibilityLabel, runStatusLabel } from "@/lib/localization";
import { requirePermission } from "@/lib/session";

export const metadata: Metadata = { title: "МТР-анализ" };
export const dynamic = "force-dynamic";

export default async function MtrAnalysisPage() {
  const [session, repository] = await Promise.all([requirePermission("report.read"), getRepository()]);
  const { user, authorization } = session;
  const projectId = authorization.activeProjectId;
  const [runs, specifications, positions, threads] = await Promise.all([
    projectId
      ? repository.listScenarioRunsInProject(user.id, projectId, { limit: 30, includeSteps: false })
      : Promise.resolve([]),
    projectId
      ? repository.listSpecificationsInProject(user.id, projectId)
      : Promise.resolve([]),
    projectId
      ? repository.listPositionsInProject(user.id, projectId, {
          currentOnly: true,
          limit: 200,
        })
      : Promise.resolve([]),
    repository.listAgentThreads(user.id),
  ]);
  const latest = selectLatestCompletedRun(runs);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  const workspace = authorization.activeProjectId && authorization.permissionKeys.has("agent.chat") ? (
    <AgentOrchestratorWorkspace
      displayName={user.displayName}
      project={{ id: authorization.activeProjectId, label: "Демонстрационный проект МТР" }}
      specifications={specifications.map((specification) => ({
        id: specification.id,
        label: `${specification.projectCode} · ${specification.name}`,
      }))}
      positions={positions.map((position) => ({
        id: position.id,
        specificationId: position.specificationId,
        label: `${position.internalCode} · ${position.nameRu}`,
      }))}
      runs={runs.map((run) => ({
        id: run.id,
        label: `${runStatusLabel(run.status)} · ${formatDateTime(run.createdAt)}`,
      }))}
      initialContext={{
        projectId: authorization.activeProjectId,
        ...(latest ? { specificationId: latest.specificationId, runId: latest.id } : {}),
      }}
      initialThreads={threads.map((thread) => ({
        id: thread.id,
        title: thread.title,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        version: thread.version,
      }))}
      initialPeriod={{ from: weekAgo.toISOString(), to: now.toISOString() }}
    />
  ) : null;

  if (!latest) {
    return (
      <>
        <PageHeader
          eyebrow="Подтверждённые результаты"
          title="МТР-анализ"
          description="Последний завершённый анализ по актуальной версии спецификации."
        />
        {workspace}
        <EmptyState />
      </>
    );
  }

  const { report } = await getReport(user.id, latest.id);
  const records = await repository.listAnalysisResultsInProject(user.id, projectId!, latest.id);
  const reviews = authorization.permissionKeys.has("review.queue.read")
    ? await repository.ensureAnalysisReviews(user.id, records.map((record) => ({
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
    })))
    : [];
  const decided = report.results.filter((result) => responsibilityState(result) === "RESOLVED");
  const customerRows = decided.filter((result) => result.responsibility === "CUSTOMER");
  const contractorRows = decided.filter((result) => result.responsibility === "CONTRACTOR");
  const reviewRows = report.results.filter((result) => responsibilityState(result) === "REVIEW_REQUIRED");
  const insufficientRows = report.results.filter((result) => responsibilityState(result) === "INSUFFICIENT_DATA");
  const ruleManifest = responsibilityManifest(report.provenance.responsibilityRuleManifest);

  return (
    <>
      <PageHeader
        eyebrow="Подтверждённые результаты"
        title="МТР-анализ"
        description={`Последний завершённый отчёт от ${formatDateTime(report.generatedAt)}. Решение определяется применимым нормативным правилом, а не требованием 100% уверенности.`}
      />
      {workspace}
      <nav aria-label="Подразделы МТР-анализа" className="mb-5 grid gap-3 md:grid-cols-3">
        <SectionLink href="#responsibility" number="01" title="Ответственность по позициям" description="Решение, уверенность и нормативное основание" />
        <SectionLink href="#doublechecker" number="02" title="Даблчекер МТР" description="Независимая проверка и решение эксперта" />
        <SectionLink href="#full-report" number="03" title="Полный отчет" description="Все результаты, источники и выгрузка" />
      </nav>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Заказчик" value={`${customerRows.length} поз.`} detail={requiredVolumes(customerRows)} />
        <Metric label="Подрядчик" value={`${contractorRows.length} поз.`} detail={requiredVolumes(contractorRows)} />
        <Metric label="Требуется решение" value={`${reviewRows.length} поз.`} detail={requiredVolumes(reviewRows)} warning />
        <Metric label="Недостаточно данных" value={`${insufficientRows.length} поз.`} detail={requiredVolumes(insufficientRows)} warning />
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
                const state = responsibilityState(result);
                const needsDecision = state !== "RESOLVED";
                return (
                  <tr key={result.position.id}>
                    <td className="px-4 py-3"><p className="font-mono text-xs font-semibold text-teal-800">{result.position.internalCode}</p><p className="mt-1 font-medium">{result.position.nameRu}</p></td>
                    <td className={`px-4 py-3 font-medium ${needsDecision ? "text-amber-800" : "text-slate-900"}`}>{responsibilityDecisionLabel(result)}</td>
                    <td className="px-4 py-3 tabular-nums">{result.responsibilityConfidence === null ? "—" : `${Math.round(result.responsibilityConfidence * 100)}%`}</td>
                    <td className="max-w-md px-4 py-3 text-slate-600">{result.responsibilityExplanation ?? "Объяснение не сохранено"}</td>
                    <td className="px-4 py-3 text-xs">{result.responsibilityCitation ? <><p>{result.responsibilityCitation.title}</p><p className="mt-1 text-slate-500">v{result.responsibilityCitation.version} · {result.responsibilityCitation.clauseId}</p></> : <p>Нормативное основание не найдено</p>}</td>
                    <td className="px-4 py-3 text-xs">{result.manualResponsibilityOverrides?.length ? `Изменено вручную · ${result.manualResponsibilityOverrides.at(-1)?.actor}` : state === "REVIEW_REQUIRED" ? "В очереди эксперта" : state === "INSUFFICIENT_DATA" ? "Нужно нормативное основание" : "Подтверждено правилом"}</td>
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
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
          <ReportFact label="ID запуска" value={latest.id} />
          <ReportFact label="Позиций" value={String(report.results.length)} />
          <ReportFact label="Решений человека" value={String(reviews.filter((review) => review.decidedBy).length)} />
          <ReportFact label="Сформирован" value={formatDateTime(report.generatedAt)} />
          <ReportFact
            label="Активный корпус правил"
            value={ruleManifest ? `${ruleManifest.activeRuleCount} правил · ${ruleManifest.datasetVersion}` : "Недоступен"}
          />
          <ReportFact
            label="Контрольная сумма правил"
            value={ruleManifest?.checksumSha256 ?? "Недоступна"}
          />
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
  return <div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-all font-semibold text-slate-900">{value}</dd></div>;
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

function responsibilityState(result: {
  responsibilityDecisionState?: "RESOLVED" | "REVIEW_REQUIRED" | "INSUFFICIENT_DATA";
  responsibility: "CUSTOMER" | "CONTRACTOR" | null;
  responsibilityCitation: { clauseId: string } | null;
  requiresHumanReview: boolean;
}) {
  return effectiveResponsibilityDecisionState(result);
}

function responsibilityDecisionLabel(result: Parameters<typeof responsibilityState>[0] & { responsibility: "CUSTOMER" | "CONTRACTOR" | null }) {
  const state = responsibilityState(result);
  if (state === "INSUFFICIENT_DATA") return "Недостаточно данных";
  if (state === "REVIEW_REQUIRED" && result.responsibility === null) return "Требуется решение";
  const label = responsibilityLabel(result.responsibility);
  return state === "REVIEW_REQUIRED" ? `${label} · требуется проверка` : label;
}

function responsibilityManifest(value: unknown): {
  activeRuleCount: number;
  datasetVersion: string;
  checksumSha256: string;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.activeRuleCount === "number" &&
    typeof record.datasetVersion === "string" &&
    typeof record.checksumSha256 === "string"
    ? {
        activeRuleCount: record.activeRuleCount,
        datasetVersion: record.datasetVersion,
        checksumSha256: record.checksumSha256,
      }
    : null;
}

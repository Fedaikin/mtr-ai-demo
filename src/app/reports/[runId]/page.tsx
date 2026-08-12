import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getReport, ReportError } from "@/application/report-service";
import { PageHeader } from "@/components/page-header";
import { ReportTable } from "@/components/report-table";
import { formatDateTime } from "@/lib/format";
import { runStatusLabel, scenarioLabel } from "@/lib/localization";
import { requireDemoRole } from "@/lib/session";

export const metadata: Metadata = { title: "Итоговый отчёт" };
export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: PageProps<"/reports/[runId]">) {
  const [{ runId }, { user }] = await Promise.all([params, requireDemoRole("USER")]);
  const { report } = await getReport(user.id, runId).catch((error: unknown) => {
    if (error instanceof ReportError && error.status === 404) notFound();
    throw error;
  });
  return (
    <>
      <PageHeader
        eyebrow="Результат анализа"
        title="Итоговый отчёт"
        description={`Пользователь: ${report.user} · состояние: ${runStatusLabel(report.status)} · сценарий: ${scenarioLabel(report.scenarioId)} · запуск ${runId.slice(-12)} · сформирован ${formatDateTime(report.generatedAt)} · только синтетические демо-данные`}
      />
      <ReportTable
        runId={runId}
        summary={report.summary}
        results={report.results}
        analogueOptions={report.analogueOptions}
        provenance={report.provenance}
      />
    </>
  );
}

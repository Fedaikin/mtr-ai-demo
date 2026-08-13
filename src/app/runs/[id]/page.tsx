import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ScenarioService, ScenarioServiceError } from "@/application/scenario-service";
import { PageHeader } from "@/components/page-header";
import { RunDetailClient } from "@/components/run-detail-client";
import { requireDemoRole } from "@/lib/session";

export const metadata: Metadata = { title: "Ход запуска" };
export const dynamic = "force-dynamic";

export default async function RunPage({ params }: PageProps<"/runs/[id]">) {
  const [{ id }, { user }, service] = await Promise.all([
    params,
    requireDemoRole("USER"),
    ScenarioService.create(),
  ]);
  const run = await service.getRun(user.id, id).catch((error: unknown) => {
    if (error instanceof ScenarioServiceError && error.status === 404) notFound();
    throw error;
  });

  return (
    <>
      <PageHeader
        eyebrow="Серверный запуск"
        title={`Запуск ${run.id.slice(-12)}`}
        description="Состояние восстановлено из базы; незавершённый запуск продолжится атомарными шагами."
      />
      <RunDetailClient initialRun={run} />
    </>
  );
}

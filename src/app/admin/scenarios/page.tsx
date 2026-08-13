import Link from "next/link";
import type { Metadata } from "next";

import { RunsWorkspace } from "@/app/runs/page";
import { getRepository } from "@/adapters/persistence/repository";
import { AdminScenarioToggle } from "@/components/admin-scenario-toggle";
import { PageHeader } from "@/components/page-header";
import { ScenarioLauncher } from "@/components/scenario-launcher";
import { integrationStatusLabel, integrationSystemLabel } from "@/lib/localization";
import { requireDemoRole } from "@/lib/session";

export const metadata: Metadata = { title: "Сценарии и запуски" };
export const dynamic = "force-dynamic";

export default async function AdminScenariosPage({ searchParams }: PageProps<"/admin/scenarios">) {
  const params = await searchParams;
  const tab = params.tab === "runs" ? "runs" : "scenarios";

  return (
    <div>
      <nav aria-label="Разделы сценариев и запусков" className="mb-5 flex gap-2 border-b border-slate-200">
        <Tab href="/admin/scenarios" active={tab === "scenarios"}>Сценарии</Tab>
        <Tab href="/admin/scenarios?tab=runs" active={tab === "runs"}>Запуски</Tab>
      </nav>
      {tab === "runs" ? <RunsWorkspace /> : <ScenariosWorkspace />}
    </div>
  );
}

function Tab({ href, active, children }: { href: string; active: boolean; children: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`focus-ring border-b-2 px-3 py-3 text-sm font-semibold ${
        active ? "border-teal-700 text-teal-800" : "border-transparent text-slate-500 hover:text-slate-800"
      }`}
    >
      {children}
    </Link>
  );
}

async function ScenariosWorkspace() {
  const [{ user }, repository] = await Promise.all([requireDemoRole("ADMIN"), getRepository()]);
  const [scenarios, specifications, integrations] = await Promise.all([
    repository.listScenarios(user.id),
    repository.listSpecifications(user.id),
    repository.listIntegrationStates(user.id),
  ]);
  const enabledScenarios = scenarios.filter((scenario) => scenario.enabled);

  return (
    <>
      <PageHeader
        eyebrow="Администрирование"
        title="Сценарии моделирования"
        description="Управление сценариями, запуск анализа и история серверных запусков собраны в одном разделе."
      />
      <div className="mb-5 flex flex-wrap gap-2" aria-label="Состояние интеграций">
        {integrations.map((integration) => (
          <span key={integration.system} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600">
            <span className="font-semibold text-slate-800">{integrationSystemLabel(integration.system)}</span> · {integrationStatusLabel(integration.state)}
          </span>
        ))}
      </div>
      <AdminScenarioToggle
        initialScenarios={scenarios.map((scenario) => ({
          id: scenario.id,
          name: scenario.name,
          enabled: scenario.enabled,
        }))}
      />
      <ScenarioLauncher
        scenarios={enabledScenarios.map((scenario) => ({
          id: scenario.id,
          name: scenario.name,
          description: scenario.description,
          defaultSpecificationId: typeof scenario.configuration.defaultSpecificationId === "string" ? scenario.configuration.defaultSpecificationId : undefined,
          defaultSeed: typeof scenario.configuration.seedSet === "string" ? scenario.configuration.seedSet : undefined,
        }))}
        specifications={specifications}
      />
    </>
  );
}

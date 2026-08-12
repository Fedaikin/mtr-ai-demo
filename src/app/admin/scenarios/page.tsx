import type { Metadata } from "next";

import { getRepository } from "@/adapters/persistence/repository";
import { AdminScenarioToggle } from "@/components/admin-scenario-toggle";
import { PageHeader } from "@/components/page-header";
import { ScenarioLauncher } from "@/components/scenario-launcher";
import { integrationStatusLabel, integrationSystemLabel } from "@/lib/localization";
import { requireDemoRole } from "@/lib/session";

export const metadata: Metadata = { title: "Моделирование" };
export const dynamic = "force-dynamic";

export default async function AdminScenariosPage() {
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
        title="Моделирование работы"
        description="Выберите управляемый сценарий. Запуск, шаги, результаты и аудит сохраняются сервером в базе данных."
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

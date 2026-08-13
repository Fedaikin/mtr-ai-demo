import type { Metadata } from "next";

import { getRepository } from "@/adapters/persistence/repository";
import {
  AdminConfigIntegrations,
  type AdminIntegrationView,
} from "@/components/admin-config-integrations";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Интеграции" };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminIntegrationsPage() {
  const [session, repository] = await Promise.all([
    requirePermission("integration.read"),
    getRepository(),
  ]);
  const states = await repository.listIntegrationStates(session.user.id);
  const integrations: AdminIntegrationView[] = states.map((state) => ({
    system: state.system,
    state: state.state,
    delayMs: state.delayMs,
    snapshotAt: state.snapshotAt ?? null,
    lastSynchronizedAt: state.lastSynchronizedAt ?? null,
    safeMessage: state.safeMessage ?? null,
    version: state.version,
  }));

  return (
    <div>
      <PageHeader
        eyebrow="Администрирование"
        title="Интеграции"
        description="Управляемые состояния демонстрационных Appius, SAP, нормативного поиска и mock LLM. Изменения влияют на следующие серверные запуски сценариев."
      />
      <AdminConfigIntegrations initialIntegrations={integrations} />
    </div>
  );
}

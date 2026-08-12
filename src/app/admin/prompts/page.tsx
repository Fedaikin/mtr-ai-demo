import type { Metadata } from "next";

import { getRepository } from "@/adapters/persistence/repository";
import { AdminConfigPrompts, type AdminPromptView } from "@/components/admin-config-prompts";
import { PageHeader } from "@/components/page-header";
import { requireDemoRole } from "@/lib/session";

export const metadata: Metadata = { title: "Промпты" };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminPromptsPage() {
  const [session, repository] = await Promise.all([
    requireDemoRole("ADMIN"),
    getRepository(),
  ]);
  const records = await repository.listPrompts(session.user.id);
  const prompts: AdminPromptView[] = records.map((prompt) => ({
    id: prompt.id,
    name: prompt.name,
    promptVersion: prompt.promptVersion,
    content: prompt.content,
    active: prompt.active,
    checksum: prompt.checksum,
    createdAt: prompt.createdAt,
    version: prompt.version,
  }));

  return (
    <div>
      <PageHeader
        eyebrow="Администрирование"
        title="Промпты AI-агента"
        description="Версионируйте системный промпт и явно выбирайте активную редакцию. Содержимое не отправляется внешнему LLM: прототип использует детерминированный mock-провайдер."
      />
      <AdminConfigPrompts initialPrompts={prompts} />
    </div>
  );
}

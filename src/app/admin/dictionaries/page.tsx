import type { Metadata } from "next";

import { getRepository } from "@/adapters/persistence/repository";
import {
  AdminConfigDictionaries,
  type AdminDictionaryView,
} from "@/components/admin-config-dictionaries";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Словари" };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminDictionariesPage() {
  const [session, repository] = await Promise.all([
    requirePermission("dictionary.manage"),
    getRepository(),
  ]);
  const records = await repository.listDictionaries(session.user.id);
  const dictionaries: AdminDictionaryView[] = records.map((dictionary) => ({
    id: dictionary.id,
    dictionaryType: dictionary.dictionaryType,
    key: dictionary.key,
    values: dictionary.values,
    active: dictionary.active,
    version: dictionary.version,
  }));

  return (
    <div>
      <PageHeader
        eyebrow="Администрирование"
        title="Словари нормализации"
        description="Редактируйте синтетические русские и английские синонимы, используемые для поиска и нормализации наименований МТР."
      />
      <AdminConfigDictionaries initialDictionaries={dictionaries} />
    </div>
  );
}

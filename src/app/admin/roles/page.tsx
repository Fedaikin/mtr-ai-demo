import type { Metadata } from "next";

import { listRolesWithPermissions } from "@/application/access-administration";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Роли и полномочия" };
export const dynamic = "force-dynamic";

export default async function RolesPage() {
  await requirePermission("global_role.manage");
  const roles = await listRolesWithPermissions();
  return <><PageHeader eyebrow="Scoped RBAC" title="Роли и полномочия" description="Permissions выдаются только через назначения ролей. Прямые пользовательские разрешения отсутствуют." /><div className="grid gap-4 xl:grid-cols-2">{roles.map((role) => <section key={String(role.id)} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs font-semibold text-teal-700">{String(role.key)}</p><h2 className="mt-1 text-lg font-semibold">{String(role.name_ru)}</h2></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{scopeLabel(String(role.scope_type))}</span></div><p className="mt-2 text-sm text-slate-500">{String(role.description_ru)}</p><div className="mt-4 flex flex-wrap gap-1.5">{(Array.isArray(role.permissions) ? role.permissions : []).map((permission) => <span key={String(permission.key)} title={String(permission.description)} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-700">{String(permission.key)}</span>)}</div></section>)}</div></>;
}
function scopeLabel(scope: string) { return scope === "GLOBAL" ? "Глобальная" : scope === "PROJECT" ? "Проектная" : "Сервисная"; }

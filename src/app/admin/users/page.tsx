import type { Metadata } from "next";

import { listAccessUsers } from "@/application/access-administration";
import { AccessUserActions } from "@/components/access-user-actions";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Пользователи и доступ" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  await requirePermission("user.manage");
  const users = await listAccessUsers();
  return <><PageHeader eyebrow="Управление доступом" title="Пользователи" description="Статус учётной записи, источник identity и назначения ролей. Изменение доступа отзывает активные сессии." /><div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Пользователь</th><th className="px-4 py-3">Тип</th><th className="px-4 py-3">Статус</th><th className="px-4 py-3">Версия доступа</th><th className="px-4 py-3">Роли и действия</th></tr></thead><tbody className="divide-y divide-slate-100">{users.map((user) => <tr key={String(user.id)}><td className="px-4 py-3"><p className="font-semibold">{String(user.display_name)}</p><p className="mt-1 font-mono text-xs text-slate-500">{String(user.login)}</p></td><td className="px-4 py-3 text-xs">{user.account_type === "SERVICE_ACCOUNT" ? "Сервисная" : "Пользователь"}<p className="mt-1 text-slate-500">{String(user.auth_source)}</p></td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${user.status === "ACTIVE" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{user.status === "ACTIVE" ? "Активен" : "Заблокирован"}</span></td><td className="px-4 py-3 tabular-nums">{String(user.authorization_version)}</td><td className="px-4 py-3"><AccessUserActions userId={String(user.id)} status={String(user.status)} assignments={Array.isArray(user.assignments) ? user.assignments : []} /></td></tr>)}</tbody></table></div></div></>;
}

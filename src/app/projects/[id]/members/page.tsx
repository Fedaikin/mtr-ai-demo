import { listProjectMembers } from "@/application/access-administration";
import { PageHeader } from "@/components/page-header";
import { ProjectMemberActions } from "@/components/project-member-actions";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";
export default async function ProjectMembersPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }] = await Promise.all([params, requirePermission("project.members.manage")]);
  const members = await listProjectMembers(id);
  return <><PageHeader eyebrow="Проектный контур" title="Участники проекта" description="Членство и проектные роли действуют только в рамках выбранного проекта. Приостановка отзывает роли и активные сессии." /><div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-4">Участник</th><th className="p-4">Статус</th><th className="p-4">Роли и действия</th></tr></thead><tbody className="divide-y">{members.map((member) => <tr key={String(member.user_id)}><td className="p-4"><b>{String(member.display_name)}</b><p className="text-xs text-slate-500">{String(member.login)}</p></td><td className="p-4">{member.status === "ACTIVE" ? "Активен" : "Приостановлен"}</td><td className="p-4"><ProjectMemberActions projectId={id} userId={String(member.user_id)} status={String(member.status)} roles={Array.isArray(member.roles) ? member.roles : []} /></td></tr>)}</tbody></table></div></>;
}

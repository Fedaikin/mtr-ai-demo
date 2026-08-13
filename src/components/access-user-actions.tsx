"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AccessUserActions({ userId, status, assignments }: { userId: string; status: string; assignments: Array<{ assignmentId: string; roleKey: string; roleName: string; scopeType: string }> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function mutate(body: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/admin/access/users/${encodeURIComponent(userId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Не удалось изменить доступ");
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось изменить доступ"); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2"><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => mutate({ action: "status", status: status === "ACTIVE" ? "BLOCKED" : "ACTIVE" })} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50">{status === "ACTIVE" ? "Заблокировать" : "Активировать"}</button><select aria-label="Назначаемая роль" disabled={busy} defaultValue="" onChange={(event) => { if (event.target.value) void mutate({ action: "assign", roleKey: event.target.value, projectId: event.target.value.startsWith("PROJECT_") || event.target.value.startsWith("MTR_") ? "demo-project-001" : null }); event.target.value = ""; }} className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"><option value="">Назначить роль…</option><option value="SYSTEM_ADMIN">Системный администратор</option><option value="AUDITOR">Аудитор</option><option value="PROJECT_VIEWER">Наблюдатель проекта</option><option value="MTR_ANALYST">Аналитик МТР</option><option value="MTR_EXPERT">Эксперт МТР</option><option value="PROJECT_MANAGER">Руководитель проекта</option></select></div><div className="flex flex-wrap gap-1">{assignments.filter((item) => item.assignmentId).map((item) => <button key={item.assignmentId} type="button" disabled={busy} onClick={() => mutate({ action: "revoke", assignmentId: item.assignmentId })} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-700 hover:bg-rose-50 hover:text-rose-800" title="Отозвать назначение">{item.roleName} ×</button>)}</div>{error ? <p role="alert" className="text-xs text-rose-700">{error}</p> : null}</div>;
}

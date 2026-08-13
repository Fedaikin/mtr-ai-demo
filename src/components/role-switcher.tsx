"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { DEMO_PERSONAS, type DemoPersonaLogin } from "@/domain/demo-personas";

export function RoleSwitcher({ currentLogin }: { currentLogin: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function switchRole(login: DemoPersonaLogin) {
    if (login === currentLogin) return;
    setPending(true); setError("");
    try {
      const response = await fetch("/api/auth/switch-role", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login }) });
      const payload = await response.json() as { redirectTo?: string; error?: { message?: string } };
      if (!response.ok || !payload.redirectTo) throw new Error(payload.error?.message ?? "Не удалось переключить роль");
      router.replace(payload.redirectTo);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось переключить роль");
      setPending(false);
    }
  }

  return <div className="relative"><label className="flex items-center gap-2 text-xs font-medium text-slate-600"><span className="hidden sm:inline">Роль</span><select aria-label="Демонстрационная роль" value={currentLogin} disabled={pending} onChange={(event) => void switchRole(event.target.value as DemoPersonaLogin)} className="focus-ring max-w-[210px] rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-800 disabled:cursor-wait disabled:opacity-60">{DEMO_PERSONAS.map((persona) => <option key={persona.login} value={persona.login}>{persona.label}</option>)}</select></label>{error ? <p role="alert" className="absolute right-0 top-10 z-30 w-64 rounded-md border border-rose-200 bg-white p-2 text-xs text-rose-700 shadow-lg">{error}</p> : null}</div>;
}

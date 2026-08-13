"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import type { AgentThreadView } from "@/components/agent-chat";
import type { AgentContextSelection } from "@/domain/agent/context";
import { AGENT_CONTEXT_RESET_EVENT } from "@/lib/agent-context-events";

const AgentChat = dynamic(() => import("@/components/agent-chat").then((module) => module.AgentChat), {
  loading: () => <div className="grid h-full place-items-center text-sm text-slate-500">Загружаем интерфейс агента…</div>,
});

export function AgentWidget({ displayName, activeProjectId }: { displayName: string; subjectId: string; authorizationVersion: number; activeProjectId: string | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [threads, setThreads] = useState<AgentThreadView[]>([]);
  const context = useMemo(() => selectionFromPath(pathname, activeProjectId), [activeProjectId, pathname]);
  useEffect(() => {
    const reset = () => {
      setOpen(false);
      setLoaded(false);
      setThreads([]);
    };
    window.addEventListener(AGENT_CONTEXT_RESET_EVENT, reset);
    return () => window.removeEventListener(AGENT_CONTEXT_RESET_EVENT, reset);
  }, []);
  useEffect(() => {
    if (!open || loaded) return;
    let active = true;
    void fetch("/api/agent/threads", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Не удалось загрузить диалоги")))
      .then((payload: { items?: AgentThreadView[] }) => { if (active) { setThreads(payload.items ?? []); setLoaded(true); } })
      .catch(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [loaded, open]);
  return <>
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="mtr-agent-widget" className={`focus-ring fixed right-5 z-40 rounded-full bg-teal-700 px-5 py-3 text-sm font-semibold text-white shadow-xl hover:bg-teal-800 ${open ? "top-3 md:bottom-5 md:top-auto" : "bottom-5"}`}>{open ? "Закрыть агента" : "МТР-агент"}</button>
    {open && <aside id="mtr-agent-widget" aria-label="МТР-агент" className="fixed inset-0 z-30 bg-white pt-16 md:inset-auto md:bottom-20 md:right-5 md:h-[min(720px,calc(100vh-7rem))] md:w-[min(760px,calc(100vw-2.5rem))] md:overflow-hidden md:rounded-2xl md:border md:border-slate-200 md:pt-0 md:shadow-2xl">
      {!loaded ? <div className="grid h-full place-items-center text-sm text-slate-500">Загружаем защищённый контекст…</div> : <div className="h-full overflow-auto"><AgentChat displayName={displayName} initialThreads={threads} initialThreadId={null} initialMessages={[]} context={context} /></div>}
    </aside>}
  </>;
}

function selectionFromPath(pathname: string, projectId: string | null): AgentContextSelection {
  const segments = pathname.split("/").filter(Boolean);
  const selection: AgentContextSelection = projectId ? { projectId } : {};
  if (segments[0] === "specifications" && segments[1]) return { ...selection, specificationId: decodeURIComponent(segments[1]) };
  if ((segments[0] === "runs" || segments[0] === "reports") && segments[1]) return { ...selection, runId: decodeURIComponent(segments[1]) };
  return selection;
}

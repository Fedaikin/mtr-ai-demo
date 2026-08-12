"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

type AnalyticsTab = "overview" | "positions" | "agent";
type AnalyticsContentTab = Exclude<AnalyticsTab, "agent">;

const TABS: ReadonlyArray<{ id: AnalyticsTab; label: string }> = [
  { id: "overview", label: "Обзор" },
  { id: "positions", label: "Позиции" },
  { id: "agent", label: "AI-агент" },
];

export function AnalyticsWorkspace({
  overview,
  positions,
  agent,
}: {
  overview: ReactNode;
  positions: ReactNode;
  agent: ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>("overview");
  const agentReturnTab = useRef<AnalyticsContentTab>("overview");
  const agentReturnScrollY = useRef(0);
  const pendingScrollRestore = useRef<number | null>(null);
  const agentOpen = activeTab === "agent";

  useEffect(() => {
    if (!agentOpen) {
      const scrollY = pendingScrollRestore.current;
      if (scrollY === null) return;
      pendingScrollRestore.current = null;
      const frame = window.requestAnimationFrame(() => window.scrollTo(0, scrollY));
      return () => window.cancelAnimationFrame(frame);
    }
    const previous = document.body.style.overflow;
    const mobile = window.matchMedia("(max-width: 1023px)").matches;
    if (mobile) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [agentOpen]);

  function openAgent(): void {
    if (activeTab !== "agent") {
      agentReturnTab.current = activeTab;
      agentReturnScrollY.current = window.scrollY;
    }
    setActiveTab("agent");
  }

  function selectTab(tab: AnalyticsTab): void {
    if (tab === "agent") {
      openAgent();
      return;
    }
    setActiveTab(tab);
  }

  function closeAgent(): void {
    pendingScrollRestore.current = agentReturnScrollY.current;
    setActiveTab(agentReturnTab.current);
  }

  return (
    <section aria-label="Рабочая область аналитики" className="min-w-0">
      <div className="mb-4 flex items-center gap-2">
        <div
          className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm"
          role="tablist"
          aria-label="Разделы аналитики"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`analytics-panel-${tab.id}`}
              id={`analytics-tab-${tab.id}`}
              onClick={() => selectTab(tab.id)}
              className={`focus-ring rounded-md px-3 py-2 text-sm font-medium transition-colors sm:px-4 ${
                activeTab === tab.id
                  ? "bg-teal-700 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={openAgent}
          className="focus-ring ml-auto rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 lg:hidden"
        >
          Открыть AI-агента
        </button>
      </div>

      <div
        id="analytics-panel-overview"
        role="tabpanel"
        aria-labelledby="analytics-tab-overview"
        hidden={activeTab !== "overview"}
      >
        {overview}
      </div>
      <div
        id="analytics-panel-positions"
        role="tabpanel"
        aria-labelledby="analytics-tab-positions"
        hidden={activeTab !== "positions"}
      >
        {positions}
      </div>
      <div
        id="analytics-panel-agent"
        role="tabpanel"
        aria-labelledby="analytics-tab-agent"
        hidden={!agentOpen}
        className={
          agentOpen
            ? "fixed inset-0 z-50 flex min-h-0 flex-col bg-[#f5f7f6] lg:static lg:h-[calc(100dvh-19rem)] lg:min-h-[360px] lg:bg-transparent"
            : undefined
        }
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 lg:hidden">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Аналитика</p>
            <p className="text-sm font-semibold text-slate-950">AI-агент</p>
          </div>
          <button
            type="button"
            onClick={closeAgent}
            className="focus-ring rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
          >
            Закрыть
          </button>
        </div>
        <div className="min-h-0 flex-1 p-2 sm:p-3 lg:p-0">{agent}</div>
      </div>
    </section>
  );
}

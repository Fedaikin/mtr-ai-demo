import Link from "next/link";
import type { ReactNode } from "react";

import { AppNavigation } from "@/components/app-navigation";
import { AgentWidget } from "@/components/agent-widget";
import { LogoutButton } from "@/components/logout-button";
import type { NavigationItem } from "@/lib/navigation";

const USER_NAVIGATION = [
  { name: "Обзор", href: "/" },
  { name: "Промышленный каталог", href: "/catalog" },
  { name: "Спецификации", href: "/specifications" },
  { name: "МТР-анализ", href: "/mtr-analysis" },
  { name: "Пульс МТР", href: "/pulse" },
] as const satisfies readonly NavigationItem[];

const ADMIN_NAVIGATION = [
  { name: "Сценарии и запуски", href: "/admin/scenarios" },
  { name: "Интеграции", href: "/admin/integrations" },
  { name: "Промпты", href: "/admin/prompts" },
  { name: "Словари", href: "/admin/dictionaries" },
  { name: "Логи агента", href: "/admin/agent-logs" },
  { name: "Аудит", href: "/admin/audit" },
] as const satisfies readonly NavigationItem[];

export function AppShell({ children, displayName }: { children: ReactNode; displayName: string }) {
  return (
    <div className="min-h-screen bg-[#f5f7f6] text-slate-950">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-white px-4 py-2 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Перейти к содержимому
      </a>
      <div className="mx-auto grid min-h-screen w-full max-w-[1440px] grid-cols-[minmax(0,1fr)] lg:grid-cols-[232px_minmax(0,1fr)]">
        <aside className="min-w-0 border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
          <div className="flex h-16 items-center justify-between border-b border-slate-100 px-5">
            <Link href="/" className="focus-ring rounded-md" aria-label="МТР — на главную">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-700">
                Демо-система
              </span>
              <span className="text-base font-semibold tracking-tight">Анализ МТР</span>
            </Link>
            <span className="rounded-full bg-teal-50 px-2 py-1 text-[10px] font-semibold text-teal-800 lg:hidden">
              MOCK
            </span>
          </div>
          <AppNavigation userItems={USER_NAVIGATION} adminItems={ADMIN_NAVIGATION} />
          <div className="hidden border-t border-slate-100 p-4 lg:absolute lg:bottom-0 lg:block lg:w-[231px]">
            <p className="text-xs text-slate-500">Текущий пользователь</p>
            <p className="mt-1 truncate text-sm font-medium">{displayName}</p>
            <p className="mt-2 text-[11px] leading-4 text-slate-500">Только синтетические демонстрационные данные</p>
          </div>
        </aside>
        <div className="min-w-0">
          <header className="flex min-h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
            <div>
              <p className="text-xs text-slate-500">Оперативный контур · mock</p>
              <p className="text-sm font-medium">{displayName}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800 sm:inline-flex">
                Локальная модель
              </span>
              <LogoutButton className="focus-ring rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60" />
            </div>
          </header>
          <main id="main-content" className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
      </div>
      <AgentWidget displayName={displayName} />
    </div>
  );
}

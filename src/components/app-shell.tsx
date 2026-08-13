import Link from "next/link";
import type { ReactNode } from "react";

import { AppNavigation } from "@/components/app-navigation";
import { AgentWidget } from "@/components/agent-widget";
import { LogoutButton } from "@/components/logout-button";
import { RoleSwitcher } from "@/components/role-switcher";
import type { NavigationItem } from "@/lib/navigation";
import { ROLE_LABELS, type PermissionKey, type RoleKey } from "@/domain/rbac";

const USER_NAVIGATION = [
  { name: "Обзор", href: "/", permissions: ["project.read"] },
  { name: "Промышленный каталог", href: "/catalog", permissions: ["catalog.read"] },
  { name: "Спецификации", href: "/specifications", permissions: ["specification.read"] },
  { name: "МТР-анализ", href: "/mtr-analysis", permissions: ["report.read"] },
  { name: "Экспертная очередь", href: "/reviews", permissions: ["review.queue.read"] },
  { name: "Пульс МТР", href: "/pulse", permissions: ["analysis.read"] },
] as const;

const ADMIN_NAVIGATION = [
  { name: "Сценарии и запуски", href: "/admin/scenarios", permissions: ["analysis.read", "scenario_template.manage"] },
  { name: "Пользователи", href: "/admin/users", permissions: ["user.manage"] },
  { name: "Роли", href: "/admin/roles", permissions: ["global_role.manage"] },
  { name: "Участники проекта", href: "/projects/demo-project-001/members", permissions: ["project.members.manage"] },
  { name: "Интеграции", href: "/admin/integrations", permissions: ["integration.read"] },
  { name: "Промпты", href: "/admin/prompts", permissions: ["prompt.manage"] },
  { name: "Словари", href: "/admin/dictionaries", permissions: ["dictionary.manage"] },
  { name: "Логи агента", href: "/admin/agent-logs", permissions: ["agent.logs.read"] },
  { name: "Аудит", href: "/admin/audit", permissions: ["audit.read.global", "audit.read.project"] },
] as const;

export function AppShell({ children, displayName, login, permissionKeys, roleKeys, roleSelectorEnabled }: { children: ReactNode; displayName: string; login: string; permissionKeys: readonly string[]; roleKeys: readonly string[]; roleSelectorEnabled: boolean }) {
  const permissions = new Set(permissionKeys);
  const userItems = visibleItems(USER_NAVIGATION, permissions);
  const adminItems = visibleItems(ADMIN_NAVIGATION, permissions);
  const roleNames = roleKeys.map((role) => ROLE_LABELS[role as RoleKey] ?? role).join(" · ");
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
          <AppNavigation userItems={userItems} adminItems={adminItems} />
          <div className="hidden border-t border-slate-100 p-4 lg:absolute lg:bottom-0 lg:block lg:w-[231px]">
            <p className="text-xs text-slate-500">Текущий пользователь</p>
            <p className="mt-1 truncate text-sm font-medium">{displayName}</p>
            <p className="mt-1 text-[11px] leading-4 text-teal-700">{roleNames || "Без активной роли"}</p>
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
              {roleSelectorEnabled ? <RoleSwitcher currentLogin={login} /> : null}
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
      {permissions.has("agent.chat") ? <AgentWidget displayName={displayName} /> : null}
    </div>
  );
}

function visibleItems(items: readonly { name: string; href: string; permissions: readonly PermissionKey[] }[], permissions: ReadonlySet<string>): NavigationItem[] {
  return items.filter((item) => item.permissions.some((permission) => permissions.has(permission))).map(({ name, href }) => ({ name, href }));
}

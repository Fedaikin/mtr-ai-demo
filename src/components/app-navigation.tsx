"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { resolveActiveNavigationHref, type NavigationItem } from "@/lib/navigation";

export function AppNavigation({
  userItems,
  adminItems,
}: {
  userItems: readonly NavigationItem[];
  adminItems: readonly NavigationItem[];
}) {
  const pathname = usePathname();
  const activeHref = resolveActiveNavigationHref(pathname);

  return (
    <nav
      aria-label="Основная навигация"
      className="flex gap-1 overflow-x-auto px-3 py-3 lg:block lg:space-y-5 lg:overflow-visible"
    >
      <NavGroup label="Рабочее место" items={userItems} activeHref={activeHref} />
      <NavGroup label="Администрирование" items={adminItems} activeHref={activeHref} />
    </nav>
  );
}

function NavGroup({
  label,
  items,
  activeHref,
}: {
  label: string;
  items: readonly NavigationItem[];
  activeHref: string;
}) {
  return (
    <div className="shrink-0">
      <p className="mb-1 hidden px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 lg:block">
        {label}
      </p>
      <div className="flex gap-1 lg:block lg:space-y-0.5">
        {items.map(({ name, href }) => {
          const active = href === activeHref;
          return (
            <Link
              key={href}
              href={href}
              prefetch={href === "/runs" ? false : true}
              aria-current={active ? "page" : undefined}
              className={`focus-ring relative block whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-teal-50 font-semibold text-teal-950 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-teal-600"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              }`}
            >
              {name}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export interface NavigationItem {
  name: string;
  href: string;
}

const ANALYTICS_RELATED_PREFIXES = ["/agent", "/mtr-analysis", "/materials/", "/reports/"] as const;

export function resolveActiveNavigationHref(pathname: string): string {
  if (pathname === "/") return "/";
  if (pathname === "/analytics" || pathname.startsWith("/analytics/")) return "/analytics";
  if (pathname === "/catalog" || pathname.startsWith("/catalog/")) return "/catalog";
  if (ANALYTICS_RELATED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
    return "/mtr-analysis";
  }
  if (pathname === "/specifications" || pathname.startsWith("/specifications/")) {
    return "/specifications";
  }
  if (pathname === "/runs" || pathname.startsWith("/runs/") || pathname.startsWith("/modeling")) {
    return "/admin/scenarios";
  }
  if (pathname.startsWith("/pulse")) return "/pulse";
  if (pathname === "/help" || pathname.startsWith("/help/")) return "/help";
  if (pathname.startsWith("/reviews")) return "/reviews";
  if (pathname.startsWith("/admin/users")) return "/admin/users";
  if (pathname.startsWith("/admin/roles")) return "/admin/roles";
  if (pathname.startsWith("/projects/") && pathname.endsWith("/members")) return "/projects/demo-project-001/members";
  if (pathname.startsWith("/admin/agent-logs")) return "/admin/agent-logs";
  if (pathname.startsWith("/admin/scenarios")) return "/admin/scenarios";
  if (pathname.startsWith("/admin/integrations")) return "/admin/integrations";
  if (pathname.startsWith("/admin/prompts")) return "/admin/prompts";
  if (pathname.startsWith("/admin/dictionaries")) return "/admin/dictionaries";
  if (pathname.startsWith("/admin/audit")) return "/admin/audit";
  return "";
}

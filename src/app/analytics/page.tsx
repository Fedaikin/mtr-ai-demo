import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { GeneralAnalyticsDashboard } from "@/components/general-analytics-dashboard";
import { PageHeader } from "@/components/page-header";
import { dashboardAudienceForPersona } from "@/domain/demo-personas";
import { analyticsAccessProfile, buildAnalyticsSnapshot, parseAnalyticsFilters } from "@/domain/general-analytics";
import { GENERAL_ANALYTICS_BASELINE, GENERAL_ANALYTICS_CATEGORY_ROWS, GENERAL_ANALYTICS_NOMENCLATURE } from "@/domain/general-analytics-fixture";
import { getDemoSession } from "@/lib/session";

export const metadata: Metadata = { title: "Общая аналитика" };
export const dynamic = "force-dynamic";

export default async function GeneralAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, session] = await Promise.all([searchParams, getDemoSession()]);
  if (!session.authorization.permissionKeys.has("analysis.read")) redirect("/forbidden");
  const audience = dashboardAudienceForPersona(session.user.login, session.authorization.projectRoleKeys);
  const access = analyticsAccessProfile(audience, session.authorization.permissionKeys.has("stock.search"));
  const filters = parseAnalyticsFilters(params, access);
  const snapshot = buildAnalyticsSnapshot(GENERAL_ANALYTICS_BASELINE, filters, access);
  const sourceRows = access.canSeeExactNomenclature ? GENERAL_ANALYTICS_NOMENCLATURE : GENERAL_ANALYTICS_CATEGORY_ROWS;
  const nomenclature = sourceRows
    .filter((row) => filters.category === "ALL" || row.category === filters.category)
    .map((row) => ({ ...row, quantity: access.canSeeExactNomenclature ? Math.round(row.quantity * (filters.warehouse === "ALL" ? 1 : 0.27)) : row.quantity }));
  return <><PageHeader eyebrow="Аналитический контур" title="Общая аналитика" description="Запасы, расход, обработка спецификаций, загрузка, KPI/SLA и прогнозы в разрешённом ролевом охвате." /><GeneralAnalyticsDashboard access={access} filters={filters} snapshot={snapshot} nomenclature={nomenclature} freshness={new Date(GENERAL_ANALYTICS_BASELINE.latestSnapshotAt ?? "2026-08-11T00:00:00.000Z").toLocaleDateString("ru-RU")} /></>;
}

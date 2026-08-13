import { describe, expect, it } from "vitest";

import { analyticsAccessProfile, buildAnalyticsSnapshot, parseAnalyticsFilters } from "@/domain/general-analytics";

describe("general analytics RBAC", () => {
  it("keeps exact warehouse detail out of executive analytics", () => {
    const access = analyticsAccessProfile("EXECUTIVE", false);
    expect(parseAnalyticsFilters({ warehouse: "WH-DEMO-CENTRAL" }, access).warehouse).toBe("ALL");
    expect(access.canSeeExactNomenclature).toBe(false);
  });

  it("allows managers to filter the team view by warehouse and department", () => {
    const access = analyticsAccessProfile("MANAGER", true);
    expect(parseAnalyticsFilters({ warehouse: "WH-DEMO-MRO", department: "MAINTENANCE" }, access)).toMatchObject({ warehouse: "WH-DEMO-MRO", department: "MAINTENANCE" });
    expect(access.canSeeTeamBreakdown).toBe(true);
  });

  it("builds deterministic reconciled series", () => {
    const access = analyticsAccessProfile("SPECIALIST", true);
    const filters = parseAnalyticsFilters({ period: "90", process: "ANALYSIS" }, access);
    const snapshot = buildAnalyticsSnapshot({ stock: 1000, catalogItems: 100, specificationCount: 3, specificationPositions: 80, totalRuns: 10, completedRuns: 8, failedRuns: 1, openRuns: 1, latestSnapshotAt: "2026-08-11T00:00:00.000Z" }, filters, access);
    expect(snapshot.series).toHaveLength(8);
    expect(snapshot.series.at(-1)?.inventory).toBe(snapshot.stock + Math.round(snapshot.stock * Math.sin((7 + 0) * 0.9) * 0.035));
    expect(snapshot.sla).toBeGreaterThanOrEqual(72);
  });
});

import type { DashboardAudience } from "@/domain/demo-personas";

export const ANALYTICS_PERIODS = [30, 90, 180, 365] as const;
export const ANALYTICS_WAREHOUSES = ["ALL", "WH-DEMO-CENTRAL", "WH-DEMO-MRO", "WH-DEMO-PROJECT", "WH-DEMO-RESERVE"] as const;
export const ANALYTICS_DEPARTMENTS = ["ALL", "PROJECT", "PROCUREMENT", "MAINTENANCE", "ENGINEERING"] as const;
export const ANALYTICS_PROCESSES = ["ALL", "SPECIFICATION", "ANALYSIS", "EXPERT_REVIEW", "SUPPLY"] as const;
export const ANALYTICS_CATEGORIES = ["ALL", "PIPING", "VALVES", "INSTRUMENTATION", "ELECTRICAL", "ROTATING", "MRO"] as const;

export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];
export type AnalyticsWarehouse = (typeof ANALYTICS_WAREHOUSES)[number];
export type AnalyticsDepartment = (typeof ANALYTICS_DEPARTMENTS)[number];
export type AnalyticsProcess = (typeof ANALYTICS_PROCESSES)[number];
export type AnalyticsCategory = (typeof ANALYTICS_CATEGORIES)[number];
export type AnalyticsScope = "PROJECT_AGGREGATE" | "PERSONAL" | "TEAM" | "ENTERPRISE";

export interface AnalyticsFilters {
  period: AnalyticsPeriod;
  warehouse: AnalyticsWarehouse;
  department: AnalyticsDepartment;
  process: AnalyticsProcess;
  category: AnalyticsCategory;
}

export interface AnalyticsAccessProfile {
  scope: AnalyticsScope;
  scopeLabel: string;
  detailLabel: string;
  canFilterWarehouse: boolean;
  canFilterDepartment: boolean;
  canSeeTeamBreakdown: boolean;
  canSeeExactNomenclature: boolean;
}

export interface AnalyticsBaseline {
  stock: number;
  catalogItems: number;
  specificationCount: number;
  specificationPositions: number;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  openRuns: number;
  latestSnapshotAt: string | null;
}

export function analyticsAccessProfile(audience: DashboardAudience, canSearchStock: boolean): AnalyticsAccessProfile {
  if (audience === "SPECIALIST") return { scope: "PERSONAL", scopeLabel: "Личный контур", detailLabel: "Задачи и номенклатура специалиста", canFilterWarehouse: canSearchStock, canFilterDepartment: false, canSeeTeamBreakdown: false, canSeeExactNomenclature: true };
  if (audience === "MANAGER") return { scope: "TEAM", scopeLabel: "Контур команды", detailLabel: "Проект, подразделения и исполнители", canFilterWarehouse: canSearchStock, canFilterDepartment: true, canSeeTeamBreakdown: true, canSeeExactNomenclature: true };
  if (audience === "EXECUTIVE") return { scope: "ENTERPRISE", scopeLabel: "Управленческий контур", detailLabel: "Агрегированные KPI и прогнозы", canFilterWarehouse: false, canFilterDepartment: true, canSeeTeamBreakdown: false, canSeeExactNomenclature: false };
  return { scope: "PROJECT_AGGREGATE", scopeLabel: "Проектный контур", detailLabel: "Агрегированные показатели без складской детализации", canFilterWarehouse: false, canFilterDepartment: false, canSeeTeamBreakdown: false, canSeeExactNomenclature: false };
}

export function parseAnalyticsFilters(
  raw: Record<string, string | string[] | undefined>,
  access: AnalyticsAccessProfile,
): AnalyticsFilters {
  const period = numericOption(raw.period, ANALYTICS_PERIODS, 90);
  const warehouse = access.canFilterWarehouse ? stringOption(raw.warehouse, ANALYTICS_WAREHOUSES, "ALL") : "ALL";
  const department = access.canFilterDepartment ? stringOption(raw.department, ANALYTICS_DEPARTMENTS, "ALL") : access.scope === "PERSONAL" ? "PROJECT" : "ALL";
  return {
    period,
    warehouse,
    department,
    process: stringOption(raw.process, ANALYTICS_PROCESSES, "ALL"),
    category: stringOption(raw.category, ANALYTICS_CATEGORIES, "ALL"),
  };
}

export function buildAnalyticsSnapshot(baseline: AnalyticsBaseline, filters: AnalyticsFilters, access: AnalyticsAccessProfile) {
  const factor = scopeFactor(access.scope) * dimensionFactor(filters);
  const stock = Math.max(0, Math.round(baseline.stock * factor));
  const consumption = Math.round(stock * (filters.period / 365) * (0.52 + processIndex(filters.process) * 0.04));
  const processedPositions = Math.max(0, Math.round(baseline.specificationPositions * factor * Math.min(1, filters.period / 90)));
  const runs = Math.max(0, Math.round(baseline.totalRuns * factor));
  const completed = Math.min(runs, Math.round(baseline.completedRuns * factor));
  const failed = Math.min(runs, Math.round(baseline.failedRuns * factor));
  const sla = runs === 0 ? 96 : Math.max(72, Math.min(99, Math.round((completed / Math.max(1, runs)) * 100)));
  const forecastShortage = Math.max(0, Math.round(consumption * 1.18 - stock * 0.42));
  const anchor = new Date(baseline.latestSnapshotAt ?? "2026-08-11T00:00:00.000Z");
  const series = Array.from({ length: 8 }, (_, index) => {
    const progress = index / 7;
    const date = new Date(anchor);
    date.setUTCDate(date.getUTCDate() - Math.round(filters.period * (1 - progress)));
    const wave = Math.sin((index + categoryIndex(filters.category)) * 0.9) * 0.035;
    const inventory = Math.max(0, Math.round(stock * (0.83 + progress * 0.17 + wave)));
    const spent = Math.max(0, Math.round(consumption * (0.08 + progress * 0.92)));
    return { label: date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" }), inventory, consumption: spent };
  });
  const stages = [
    { label: "Получено", value: Math.max(baseline.specificationCount, 1) * 12 },
    { label: "Проверено", value: Math.round(Math.max(baseline.specificationCount, 1) * 10.8) },
    { label: "В анализе", value: Math.round(Math.max(baseline.specificationCount, 1) * 8.9) },
    { label: "Завершено", value: Math.round(Math.max(baseline.specificationCount, 1) * 8.1) },
  ].map((stage) => ({ ...stage, value: Math.max(0, Math.round(stage.value * factor)) }));
  return { stock, consumption, processedPositions, runs, completed, failed, sla, forecastShortage, series, stages };
}

function scopeFactor(scope: AnalyticsScope): number {
  return ({ PERSONAL: 0.18, TEAM: 0.62, ENTERPRISE: 1, PROJECT_AGGREGATE: 0.82 } as const)[scope];
}

function dimensionFactor(filters: AnalyticsFilters): number {
  const warehouse = filters.warehouse === "ALL" ? 1 : 0.22 + ANALYTICS_WAREHOUSES.indexOf(filters.warehouse) * 0.035;
  const department = filters.department === "ALL" ? 1 : 0.19 + ANALYTICS_DEPARTMENTS.indexOf(filters.department) * 0.025;
  const process = filters.process === "ALL" ? 1 : 0.64 + ANALYTICS_PROCESSES.indexOf(filters.process) * 0.025;
  const category = filters.category === "ALL" ? 1 : 0.12 + ANALYTICS_CATEGORIES.indexOf(filters.category) * 0.012;
  return warehouse * department * process * category;
}

function processIndex(value: AnalyticsProcess): number { return Math.max(0, ANALYTICS_PROCESSES.indexOf(value)); }
function categoryIndex(value: AnalyticsCategory): number { return Math.max(0, ANALYTICS_CATEGORIES.indexOf(value)); }

function numericOption<const T extends readonly number[]>(value: string | string[] | undefined, options: T, fallback: T[number]): T[number] {
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  return options.includes(parsed as T[number]) ? parsed as T[number] : fallback;
}

function stringOption<const T extends readonly string[]>(value: string | string[] | undefined, options: T, fallback: T[number]): T[number] {
  return typeof value === "string" && options.includes(value as T[number]) ? value as T[number] : fallback;
}

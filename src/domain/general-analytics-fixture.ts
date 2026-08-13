import { INDUSTRIAL_CATALOGUE_MANIFEST, INDUSTRIAL_CATALOGUE_SNAPSHOT_AT } from "@/adapters/mock/fixtures/industrial-catalogue";
import type { AnalyticsBaseline, AnalyticsCategory } from "@/domain/general-analytics";

export const GENERAL_ANALYTICS_BASELINE: AnalyticsBaseline = Object.freeze({
  stock: 128_640,
  catalogItems: INDUSTRIAL_CATALOGUE_MANIFEST.expectedItemCount,
  specificationCount: 18,
  specificationPositions: 1_248,
  totalRuns: 42,
  completedRuns: 38,
  failedRuns: 2,
  openRuns: 2,
  latestSnapshotAt: INDUSTRIAL_CATALOGUE_SNAPSHOT_AT,
});

export const GENERAL_ANALYTICS_NOMENCLATURE = Object.freeze([
  { code: "CAT-DEMO-PIP-0005", name: "Труба бесшовная технологическая", category: "PIPING", quantity: 1840, trend: -7 },
  { code: "CAT-DEMO-VAL-0805", name: "Задвижка клиновая фланцевая", category: "VALVES", quantity: 428, trend: -4 },
  { code: "CAT-DEMO-INS-1605", name: "Преобразователь давления", category: "INSTRUMENTATION", quantity: 316, trend: 5 },
  { code: "CAT-DEMO-ELC-2405", name: "Кабель силовой промышленный", category: "ELECTRICAL", quantity: 2690, trend: -11 },
  { code: "CAT-DEMO-ROT-3205", name: "Насос центробежный", category: "ROTATING", quantity: 84, trend: -9 },
  { code: "CAT-DEMO-MRO-4005", name: "Комплект крепежа", category: "MRO", quantity: 1240, trend: 8 },
] as const satisfies ReadonlyArray<{ code: string; name: string; category: AnalyticsCategory; quantity: number; trend: number }>);

export const GENERAL_ANALYTICS_CATEGORY_ROWS = Object.freeze([
  { code: "ГРУППА 01", name: "Трубопроводные компоненты", category: "PIPING", quantity: 82, trend: -3 },
  { code: "ГРУППА 02", name: "Запорная и регулирующая арматура", category: "VALVES", quantity: 78, trend: 2 },
  { code: "ГРУППА 03", name: "Контрольно-измерительные приборы", category: "INSTRUMENTATION", quantity: 86, trend: 5 },
  { code: "ГРУППА 04", name: "Электротехническое оборудование", category: "ELECTRICAL", quantity: 71, trend: -6 },
  { code: "ГРУППА 05", name: "Вращающееся оборудование", category: "ROTATING", quantity: 64, trend: -9 },
  { code: "ГРУППА 06", name: "Материалы ремонта и обслуживания", category: "MRO", quantity: 91, trend: 7 },
] as const satisfies ReadonlyArray<{ code: string; name: string; category: AnalyticsCategory; quantity: number; trend: number }>);

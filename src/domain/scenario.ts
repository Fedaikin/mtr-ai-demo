import type { ScenarioRunStatus } from "./models";

export const TERMINAL_STATUSES = new Set<ScenarioRunStatus>(["COMPLETED", "FAILED", "CANCELLED"]);

export const SCENARIO_TRANSITIONS: Record<ScenarioRunStatus, ScenarioRunStatus | null> = {
  QUEUED: "LOADING_APPIUS",
  LOADING_APPIUS: "SYNCING_SAP",
  SYNCING_SAP: "CLASSIFYING_RESPONSIBILITY",
  CLASSIFYING_RESPONSIBILITY: "MATCHING_STOCK",
  MATCHING_STOCK: "FINDING_ANALOGUES",
  FINDING_ANALOGUES: "GENERATING_REPORT",
  GENERATING_REPORT: "COMPLETED",
  COMPLETED: null,
  FAILED: null,
  CANCELLED: null,
};

export const RUN_PROGRESS: Record<ScenarioRunStatus, number> = {
  QUEUED: 0,
  LOADING_APPIUS: 12,
  SYNCING_SAP: 27,
  CLASSIFYING_RESPONSIBILITY: 43,
  MATCHING_STOCK: 62,
  FINDING_ANALOGUES: 78,
  GENERATING_REPORT: 92,
  COMPLETED: 100,
  FAILED: 100,
  CANCELLED: 100,
};

export const RUN_STATUS_LABELS: Record<ScenarioRunStatus, string> = {
  QUEUED: "В очереди",
  LOADING_APPIUS: "Загрузка актуальной версии Appius",
  SYNCING_SAP: "Синхронизация снимка SAP",
  CLASSIFYING_RESPONSIBILITY: "Распределение ответственности",
  MATCHING_STOCK: "Поиск складских совпадений",
  FINDING_ANALOGUES: "Подбор нормативно допустимых аналогов",
  GENERATING_REPORT: "Формирование отчёта",
  COMPLETED: "Завершено",
  FAILED: "Ошибка",
  CANCELLED: "Отменено",
};

export function nextRunStatus(status: ScenarioRunStatus): ScenarioRunStatus | null {
  return SCENARIO_TRANSITIONS[status];
}

export function canCancel(status: ScenarioRunStatus): boolean {
  return !TERMINAL_STATUSES.has(status);
}

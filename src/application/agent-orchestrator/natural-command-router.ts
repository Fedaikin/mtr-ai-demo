import type { AgentCommandKey } from "@/domain/agent/commands";
import type { AgentContextSelection } from "@/domain/agent/context";
import type { AgentCommandRequestMap } from "@/ports/agent-orchestrator";

export type NaturalAgentCommand = {
  readonly [K in AgentCommandKey]: Readonly<{
    commandKey: K;
    selection: AgentContextSelection;
    filters?: AgentCommandRequestMap[K]["filters"];
  }>;
}[AgentCommandKey];

/**
 * Narrow deterministic router for read-only commands. Ambiguous
 * domain questions deliberately stay in the grounded legacy capability.
 */
export function routeNaturalAgentCommand(
  message: string,
  selection: AgentContextSelection = {},
): NaturalAgentCommand | null {
  const normalized = message.trim().toLocaleLowerCase("ru-RU");
  if (!normalized) return null;

  if (/(?:почему\s+(?:возник|будет|ожидается).*дефицит|что\s+если|сравн\p{L}*\s+вариант|сценари\p{L}*\s+(?:постав|спрос|резерв)|прогноз\p{L}*\s+по\s+позици)/iu.test(normalized)) {
    const horizonDays = requestedHorizonDays(normalized);
    const positionId = message.match(/\bposition-[A-Za-z0-9-]+\b/u)?.[0];
    return {
      commandKey: "ANALYSIS",
      selection,
      filters: {
        ...(positionId === undefined ? {} : { positionId }),
        ...(horizonDays === null ? {} : { horizonWeeks: Math.max(1, Math.ceil(horizonDays / 7)) }),
      },
    };
  }

  if (/(?:\bkpi\b|\bsla\b|ключев\p{L}*\s+показател|метрик\p{L}*)/iu.test(normalized)) {
    const metricKeys = requestedMetricKeys(normalized);
    return {
      commandKey: "KPI",
      selection,
      ...(metricKeys.length > 0 ? { filters: { metricKeys } } : {}),
    };
  }
  if (/(?:мо[ия]\s+задач|задач\p{L}*\s+(?:на\s+мне|назначен\p{L}*\s+мне)|что\s+мне\s+(?:провер|сдел))/iu.test(normalized)) {
    return { commandKey: "MY_TASKS", selection };
  }
  if (/(?:риск\p{L}*|дефицит\p{L}*|нехват\p{L}*|исчерпан\p{L}*|прогноз\p{L}*\s+(?:дефицит|нехват|остат))/iu.test(normalized)) {
    const levels = requestedRiskLevels(normalized);
    const horizonDays = requestedHorizonDays(normalized);
    const objectTypes = /(?:материал|детал|позици)/iu.test(normalized) ? ["MATERIAL"] : undefined;
    const filters = {
      ...(levels.length > 0 ? { levels } : {}),
      ...(horizonDays === null ? {} : { horizonDays }),
      ...(objectTypes === undefined ? {} : { objectTypes }),
    };
    return {
      commandKey: "RISKS",
      selection,
      ...(Object.keys(filters).length > 0 ? { filters } : {}),
    };
  }
  if (/(?:остат(?:ок|к\p{L}*)|складск\p{L}*\s+(?:налич|запас)|налич\p{L}*\s+на\s+склад)/iu.test(normalized)) {
    const materialCode = message.match(/\bSAP-DEMO-[A-Z0-9-]+\b/iu)?.[0]?.toLocaleUpperCase("en-US");
    const warehouseIds = [...message.matchAll(/\bWH-[A-Z0-9-]+\b/giu)]
      .map((match) => match[0].toLocaleUpperCase("en-US"));
    const filters = {
      ...(materialCode === undefined ? {} : { materialCode }),
      ...(warehouseIds.length > 0 ? { warehouseIds: [...new Set(warehouseIds)] } : {}),
    };
    return {
      commandKey: "STOCKS",
      selection,
      ...(Object.keys(filters).length > 0 ? { filters } : {}),
    };
  }
  if (/(?:оперативн\p{L}*\s+сводк|сводк\p{L}*\s+по\s+проект|общ\p{L}*\s+(?:состояни|итог)|что\s+сейчас\s+по\s+проект)/iu.test(normalized)) {
    return { commandKey: "SUMMARY", selection };
  }
  return null;
}

function requestedMetricKeys(message: string): string[] {
  const keys: string[] = [];
  if (/(?:заверш|выполн\p{L}*\s+анализ)/iu.test(message)) keys.push("ANALYSIS_COMPLETION_RATE");
  if (/(?:эксперт|провер\p{L}*\s+человек)/iu.test(message)) keys.push("EXPERT_REVIEW_SHARE");
  if (/(?:цикл|срок|длительн)/iu.test(message)) keys.push("BUSINESS_CYCLE_TIME");
  if (/(?:покрыт\p{L}*\s+(?:запас|остат)|обеспеченн\p{L}*\s+склад)/iu.test(message)) keys.push("STOCK_COVERAGE");
  return keys;
}

function requestedRiskLevels(message: string): Array<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL"> {
  const levels: Array<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL"> = [];
  if (/критическ/iu.test(message)) levels.push("CRITICAL");
  if (/высок\p{L}*\s+риск/iu.test(message)) levels.push("HIGH");
  if (/средн\p{L}*\s+риск/iu.test(message)) levels.push("MEDIUM");
  if (/низк\p{L}*\s+риск/iu.test(message)) levels.push("LOW");
  return levels;
}

function requestedHorizonDays(message: string): number | null {
  const value = message.match(/(?:^|\s)(\d{1,3})\s*(?:дн(?:ей|я)?|день)(?=\s|$|[.,!?])/iu)?.[1];
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 365 ? parsed : null;
}

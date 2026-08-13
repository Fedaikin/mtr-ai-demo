export const SCENARIO_TIME_ZONE = "Europe/Moscow" as const;

const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

export interface ScenarioClock {
  readonly timeZone: typeof SCENARIO_TIME_ZONE;
  now(): Date;
}

export interface MoscowCalendarDay {
  readonly localDate: string;
  readonly startsAt: string;
  readonly endsAtExclusive: string;
}

export function createSystemScenarioClock(): ScenarioClock {
  return {
    timeZone: SCENARIO_TIME_ZONE,
    now: () => new Date(),
  };
}

export function createFixedScenarioClock(instant: string | Date): ScenarioClock {
  const timestamp = instant instanceof Date ? instant.getTime() : Date.parse(instant);
  if (!Number.isFinite(timestamp)) {
    throw new Error("SCENARIO_CLOCK_INVALID_INSTANT");
  }
  return {
    timeZone: SCENARIO_TIME_ZONE,
    now: () => new Date(timestamp),
  };
}

export function moscowCalendarDay(clock: ScenarioClock): MoscowCalendarDay {
  const now = clock.now();
  assertClock(clock, now);
  const shifted = new Date(now.getTime() + MOSCOW_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const startsAtMs = Date.UTC(year, month, day) - MOSCOW_OFFSET_MS;
  return {
    localDate: isoDate(new Date(startsAtMs + MOSCOW_OFFSET_MS)),
    startsAt: new Date(startsAtMs).toISOString(),
    endsAtExclusive: new Date(startsAtMs + DAY_MS).toISOString(),
  };
}

export function scenarioInstantAtLocalHour(
  clock: ScenarioClock,
  daysFromToday: number,
  localHour = 9,
): string {
  if (!Number.isInteger(daysFromToday) || !Number.isInteger(localHour) || localHour < 0 || localHour > 23) {
    throw new Error("SCENARIO_CLOCK_INVALID_OFFSET");
  }
  const day = moscowCalendarDay(clock);
  return new Date(Date.parse(day.startsAt) + daysFromToday * DAY_MS + localHour * 60 * 60 * 1_000)
    .toISOString();
}

export function scenarioWeekStart(
  clock: ScenarioClock,
  weeksFromCurrent: number,
): string {
  if (!Number.isInteger(weeksFromCurrent)) throw new Error("SCENARIO_CLOCK_INVALID_WEEK");
  const day = moscowCalendarDay(clock);
  const local = new Date(Date.parse(day.startsAt) + MOSCOW_OFFSET_MS);
  const isoDay = local.getUTCDay() === 0 ? 7 : local.getUTCDay();
  const mondayOffset = 1 - isoDay + weeksFromCurrent * 7;
  return new Date(Date.parse(day.startsAt) + mondayOffset * DAY_MS).toISOString();
}

function assertClock(clock: ScenarioClock, now: Date): void {
  if (clock.timeZone !== SCENARIO_TIME_ZONE || !Number.isFinite(now.getTime())) {
    throw new Error("SCENARIO_CLOCK_INVALID");
  }
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

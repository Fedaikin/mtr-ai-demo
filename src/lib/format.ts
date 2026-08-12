const DATE_TIME_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Moscow",
});

const NUMBER_FORMAT = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });

export function formatDateTime(value?: string | Date | null): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : DATE_TIME_FORMAT.format(date);
}

export function formatNumber(value?: number | null): string {
  return value === null || value === undefined ? "—" : NUMBER_FORMAT.format(value);
}

export function formatDuration(milliseconds?: number | null): string {
  if (milliseconds === null || milliseconds === undefined) return "—";
  if (milliseconds < 1000) return `${milliseconds} мс`;
  return `${NUMBER_FORMAT.format(milliseconds / 1000)} с`;
}

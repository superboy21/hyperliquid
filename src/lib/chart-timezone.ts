/** Display time zones supported by the /search charts. Data timestamps remain UTC. */
export type ChartTimeZone = "UTC" | "UTC+8";

export const CHART_TIME_ZONES: readonly ChartTimeZone[] = ["UTC", "UTC+8"];

/** Use a named IANA zone so UTC+8 is stable regardless of the browser locale. */
export function chartIntlTimeZone(timeZone: ChartTimeZone): "UTC" | "Asia/Shanghai" {
  return timeZone === "UTC+8" ? "Asia/Shanghai" : "UTC";
}

export function chartYear(timestamp: number, timeZone: ChartTimeZone): number {
  const year = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    timeZone: chartIntlTimeZone(timeZone),
  }).formatToParts(new Date(timestamp)).find((part) => part.type === "year")?.value;
  return year ? Number(year) : new Date(timestamp).getUTCFullYear();
}

export function chartWeekday(timestamp: number, timeZone: ChartTimeZone): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: chartIntlTimeZone(timeZone),
  }).format(new Date(timestamp));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
}

/** Fixed-width formatter used by the exact-range readouts below every chart. */
export function formatChartDateTime(timestamp: number, timeZone: ChartTimeZone): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: chartIntlTimeZone(timeZone),
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}/${value("month")}/${value("day")} ${value("hour")}:${value("minute")}:${value("second")}`;
}

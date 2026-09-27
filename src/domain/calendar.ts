/**
 * Calendar helpers for the college's local day.
 *
 * A meal belongs to a calendar day in Jaipur, not to a UTC instant, so every date here is a plain
 * YYYY-MM-DD string resolved in the college time zone. Functions take the clock as an argument so
 * tests do not have to wait for midnight.
 */

export const COLLEGE_TIME_ZONE = "Asia/Kolkata";

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function isoTimestamp(now: Date = new Date()): string {
  return now.toISOString();
}

/** The calendar date in the college time zone, as YYYY-MM-DD. */
export function collegeDate(now: Date = new Date(), timeZone: string = COLLEGE_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const find = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${find("year")}-${find("month")}-${find("day")}`;
}

/** Weekday index for a YYYY-MM-DD string, 0 for Sunday, matching the mess_menu.weekday column. */
export function weekdayOf(dateText: string): number {
  return new Date(`${dateText}T00:00:00Z`).getUTCDay();
}

export function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday] ?? "Unknown";
}

/** Whole days from the earlier date to the later one. Negative when `to` precedes `from`. */
export function daysBetween(from: string, to: string): number {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((end - start) / millisecondsPerDay);
}

export function shiftDate(dateText: string, days: number): string {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const shifted = new Date(new Date(`${dateText}T00:00:00Z`).getTime() + days * millisecondsPerDay);
  return shifted.toISOString().slice(0, 10);
}

/** The `count` dates ending at `endDate`, oldest first, for trend charts. */
export function dateSeriesEndingAt(endDate: string, count: number): string[] {
  const series: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    series.push(shiftDate(endDate, -offset));
  }
  return series;
}

export function formatDayLabel(dateText: string): string {
  return `${weekdayName(weekdayOf(dateText)).slice(0, 3)} ${dateText.slice(8, 10)}/${dateText.slice(5, 7)}`;
}

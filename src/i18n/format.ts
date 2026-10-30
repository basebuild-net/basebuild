import { getActiveLocale, t } from "./index";

/**
 * Locale-aware formatting for display text. Use these instead of
 * `toLocaleString()` without arguments, which follows the OS language rather
 * than the UI language the user picked in Settings.
 */

/** "2m ago" / "2分钟前" for a count of one unit. */
export function formatAgo(count: number, unit: Intl.RelativeTimeFormatUnit): string {
  return new Intl.RelativeTimeFormat(getActiveLocale(), { numeric: "always", style: "narrow" }).format(-count, unit);
}

/**
 * Relative time from an epoch timestamp in seconds or milliseconds (values
 * below one trillion are seconds). Returns "" for a missing timestamp.
 */
export function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return "";
  const tsMs = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
  const seconds = Math.max(0, Math.floor((Date.now() - tsMs) / 1000));
  if (seconds < 10) return t("time.justNow");
  if (seconds < 60) return formatAgo(seconds, "second");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return formatAgo(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatAgo(hours, "hour");
  return formatAgo(Math.floor(hours / 24), "day");
}

/** Date and time in the active locale. Defaults to a medium date with a short time. */
export function formatDateTime(
  date: Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  return new Intl.DateTimeFormat(getActiveLocale(), options).format(date);
}

/** Grouped number in the active locale. Null and undefined pass through. */
export function formatNumber(value: number): string;
export function formatNumber(value: number | null | undefined): string | undefined;
export function formatNumber(value: number | null | undefined): string | undefined {
  if (value == null) return undefined;
  return new Intl.NumberFormat(getActiveLocale()).format(value);
}

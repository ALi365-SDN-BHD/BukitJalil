import type { Locale } from "@bukitjalil/shared";

/** Bytes as "12 KB" in the UI language (plan 10.1: numbers through Intl). */
export function formatSize(bytes: number, locale: Locale): string {
  const units = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: units[unit],
    unitDisplay: "short",
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
}

/** "3 minutes ago" for recent times, a date and time otherwise. */
export function formatTime(iso: string, locale: Locale, now = Date.now()): string {
  const then = Date.parse(iso);
  const seconds = Math.round((then - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return rtf.format(seconds, "second");
  if (Math.abs(seconds) < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (Math.abs(seconds) < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(then);
}

/** Seconds between two times, e.g. "4.2 s". */
export function formatDuration(startIso: string, endIso: string, locale: Locale): string {
  const seconds = (Date.parse(endIso) - Date.parse(startIso)) / 1000;
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "second",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(Math.max(seconds, 0));
}

export const shortOid = (oid: string) => oid.slice(0, 7);

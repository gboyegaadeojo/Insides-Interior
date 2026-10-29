// Business dates are Africa/Lagos calendar days (CLAUDE.md); stored as
// YYYY-MM-DD for dates and UTC ISO strings for instants.

import { BUSINESS_TZ, LOCALE } from "~/domain/locale";

export { BUSINESS_TZ };

/** Today's business date as YYYY-MM-DD. */
export function businessToday(now = new Date()): string {
  // en-CA is used only because it formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Adds whole days to a YYYY-MM-DD date (calendar arithmetic, no time zone drift). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return utc.toISOString().slice(0, 10);
}

/** "12 Nov 2026" for a YYYY-MM-DD date. */
export function formatDate(date: string | null | undefined): string {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

const DATE_TIME = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: BUSINESS_TZ,
});

/** "29 Oct, 2:05 pm" in Lagos time for a UTC instant (thread timestamps, FR-MSG-01). */
export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

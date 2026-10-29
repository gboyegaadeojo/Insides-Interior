// Report arithmetic (SPEC 5.11): ageing buckets, cash-basis allocation and
// report periods. Pure, so Home, the report screens and the CSV export agree.
//
// Definitions (SPEC 5.11): Invoiced = sent, non-void invoices by issue date.
// Cash received = payments (cash + withholding tax) by date received.
// Revenue = invoiced before tax (accrual) or the pre-tax share of cash received
// (cash). Expenses = amount paid less VAT paid.

import { mulDivRound } from "./money";

// ---------- Aged receivables (FR-RPT-02) ----------

export const AGING_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_LABEL: Record<AgingBucket, string> = {
  current: "Current",
  "1-30": "1–30 days",
  "31-60": "31–60 days",
  "61-90": "61–90 days",
  "90+": "90+ days",
};

/** Whole calendar days from `from` to `to` (YYYY-MM-DD), negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const ms = (d: string) => {
    const [y, m, day] = d.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

/** Bucket by days past the due date; not yet due (or no due date) is current. */
export function agingBucket(dueDate: string | null, today: string): AgingBucket {
  const late = dueDate ? daysBetween(dueDate, today) : 0;
  if (late <= 0) return "current";
  if (late <= 30) return "1-30";
  if (late <= 60) return "31-60";
  if (late <= 90) return "61-90";
  return "90+";
}

export type AgingRow = Record<AgingBucket, number> & { totalCents: number };

export function emptyAging(): AgingRow {
  return { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0, totalCents: 0 };
}

/** Per-client ageing plus the grand total; every open balance lands in exactly one bucket. */
export function ageBalances<T extends { clientId: string; dueDate: string | null; balanceCents: number }>(
  invoices: T[],
  today: string,
) {
  const byClient = new Map<string, AgingRow>();
  const total = emptyAging();
  for (const inv of invoices) {
    if (inv.balanceCents === 0) continue;
    const bucket = agingBucket(inv.dueDate, today);
    const row = byClient.get(inv.clientId) ?? emptyAging();
    row[bucket] += inv.balanceCents;
    row.totalCents += inv.balanceCents;
    total[bucket] += inv.balanceCents;
    total.totalCents += inv.balanceCents;
    byClient.set(inv.clientId, row);
  }
  return { byClient, total };
}

// ---------- Cash basis (FR-RPT-03) ----------

/**
 * The share of `partCents` (e.g. VAT or pre-tax revenue on an invoice) that a
 * payment represents, allocated cumulatively: the shares of payments that
 * settle the whole invoice add up to `partCents` exactly, whatever the rounding.
 */
export function cashShare(opts: {
  partCents: number;
  invoiceTotalCents: number;
  /** Settled on this invoice before this payment. */
  settledBeforeCents: number;
  /** This payment (cash + WHT). */
  paymentCents: number;
}): number {
  const { partCents, invoiceTotalCents, settledBeforeCents, paymentCents } = opts;
  if (invoiceTotalCents <= 0) return 0;
  const clamp = (c: number) => Math.min(Math.max(c, 0), invoiceTotalCents);
  const upTo = (settled: number) => mulDivRound(partCents, clamp(settled), invoiceTotalCents);
  return upTo(settledBeforeCents + paymentCents) - upTo(settledBeforeCents);
}

/** An expense for reports: what was paid less the VAT on it (SPEC 5.11 "Expenses"). */
export function expenseNetCents(e: { amountCents: number; vatCents: number }): number {
  return e.amountCents - e.vatCents;
}

/** A billable expense recharged at cost plus markup (FR-EXP-02), rounded half up. */
export function rechargeCents(costCents: number, markupBp: number): number {
  return costCents + mulDivRound(costCents, markupBp, 10_000);
}

// ---------- Periods ----------

export const PERIOD_PRESETS = ["this-month", "last-month", "this-quarter", "this-year", "last-year"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_LABEL: Record<PeriodPreset, string> = {
  "this-month": "This month",
  "last-month": "Last month",
  "this-quarter": "This quarter",
  "this-year": "This year",
  "last-year": "Last year",
};

const pad = (n: number) => String(n).padStart(2, "0");

function lastDay(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Inclusive YYYY-MM-DD range for a preset, relative to today's business date. */
export function presetRange(preset: PeriodPreset, today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const span = (y1: number, m1: number, y2: number, m2: number) => ({
    from: `${y1}-${pad(m1)}-01`,
    to: `${y2}-${pad(m2)}-${pad(lastDay(y2, m2))}`,
  });
  switch (preset) {
    case "this-month":
      return span(y, m, y, m);
    case "last-month":
      return m === 1 ? span(y - 1, 12, y - 1, 12) : span(y, m - 1, y, m - 1);
    case "this-quarter": {
      const start = Math.floor((m - 1) / 3) * 3 + 1;
      return span(y, start, y, start + 2);
    }
    case "this-year":
      return span(y, 1, y, 12);
    case "last-year":
      return span(y - 1, 1, y - 1, 12);
  }
}

/** The preset a range matches, if any (so the picker can show it selected). */
export function matchPreset(from: string, to: string, today: string): PeriodPreset | null {
  return (
    PERIOD_PRESETS.find((p) => {
      const r = presetRange(p, today);
      return r.from === from && r.to === to;
    }) ?? null
  );
}

/** YYYY-MM keys from the month of `from` to the month of `to`, inclusive (capped at 36). */
export function monthKeys(from: string, to: string): string[] {
  let [y, m] = from.split("-").map(Number) as [number, number];
  const end = to.slice(0, 7);
  const keys: string[] = [];
  while (keys.length < 36) {
    const key = `${y}-${pad(m)}`;
    if (key > end) break;
    keys.push(key);
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  return keys;
}

/** The last `count` months ending with today's, as an inclusive date range. */
export function trailingMonths(count: number, today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const startIndex = y * 12 + (m - 1) - (count - 1);
  const sy = Math.floor(startIndex / 12);
  const sm = (startIndex % 12) + 1;
  return { from: `${sy}-${pad(sm)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` };
}

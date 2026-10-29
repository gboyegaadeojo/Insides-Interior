// Money and quantity parsing/formatting (SPEC 10.1). Integer cents and integer
// thousandths only; strings are parsed digit by digit, never through floats.

import { CURRENCY, LOCALE } from "./locale";

/**
 * `numerator / denominator` rounded half away from zero, exactly (BigInt), so
 * $192.375 → $192.38 and −$0.165 → −$0.17. The one rounding primitive.
 */
export function roundHalfUpDiv(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) {
    throw new RangeError(`roundHalfUpDiv needs safe integers, got ${numerator}/${denominator}`);
  }
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  const negative = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n);
  return Number(negative ? -q : q);
}

/**
 * `a × b / d` rounded half away from zero, with the product in BigInt so two
 * large amounts (₦ millions in kobo) can be multiplied without losing precision.
 */
export function mulDivRound(a: number, b: number, d: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || !Number.isSafeInteger(d) || d === 0) {
    throw new RangeError(`mulDivRound needs safe integers, got ${a}×${b}/${d}`);
  }
  const n = BigInt(a) * BigInt(b);
  const den = BigInt(d);
  const negative = n < 0n !== den < 0n;
  const an = n < 0n ? -n : n;
  const ad = den < 0n ? -den : den;
  const q = (an * 2n + ad) / (ad * 2n);
  return Number(negative ? -q : q);
}

/** Line amount = round_half_up(qty_milli × unit_price_cents / 1000) (SPEC 10.1). */
export function lineAmountCents(qtyMilli: number, unitPriceCents: number): number {
  return roundHalfUpDiv(qtyMilli * unitPriceCents, 1000);
}

/** `cents × bp / 10000`, rounded half up: percentages and tax rates in basis points. */
export function applyBp(cents: number, bp: number): number {
  return roundHalfUpDiv(cents * bp, 10_000);
}

const CURRENCY_FORMAT = new Intl.NumberFormat(LOCALE, { style: "currency", currency: CURRENCY });
const GROUPED = new Intl.NumberFormat(LOCALE, { useGrouping: true });

/** Splits a typed decimal ("₦1,234.5") into sign, integer digits and fraction digits. */
function splitDecimal(input: string): { negative: boolean; whole: string; fraction: string } | null {
  const cleaned = input.trim().replace(/^(-)?\s*(?:[$₦]|NGN)\s*/i, "$1");
  const match = /^(-)?(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return null;
  const whole = (match[2] ?? "").replaceAll(",", "");
  const fraction = match[3] ?? "";
  if (whole === "" && fraction === "") return null;
  return { negative: match[1] === "-", whole: whole || "0", fraction };
}

/** "1,234.56" → 123456. Extra decimals round half up. Returns null if not a number. */
export function parseMoneyToCents(input: string): number | null {
  const parts = splitDecimal(input);
  if (!parts) return null;
  const padded = parts.fraction.padEnd(3, "0");
  let cents = Number(parts.whole) * 100 + Number(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) return null;
  return parts.negative ? -cents : cents;
}

/** "4.5" → 4500. At most three decimals. Returns null if not a valid quantity. */
export function parseQuantityToMilli(input: string): number | null {
  const parts = splitDecimal(input);
  if (!parts || parts.fraction.length > 3) return null;
  const milli = Number(parts.whole) * 1000 + Number(parts.fraction.padEnd(3, "0"));
  if (!Number.isSafeInteger(milli)) return null;
  return parts.negative ? -milli : milli;
}

/** 12195056 → "₦121,950.56" (en-NG, NGN). */
export function formatCents(cents: number): string {
  return CURRENCY_FORMAT.format(cents / 100);
}

/** 123456 → "1,234.56": for editable fields, no currency symbol. */
export function formatCentsPlain(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${GROUPED.format(Math.trunc(abs / 100))}.${String(abs % 100).padStart(2, "0")}`;
}

/** Basis points as a percentage for display and editing: 500 → "5", 750 → "7.5", 1234 → "12.34". */
export function formatBp(bp: number): string {
  const sign = bp < 0 ? "-" : "";
  const abs = Math.abs(bp);
  const fraction = String(abs % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${sign}${Math.trunc(abs / 100)}${fraction ? `.${fraction}` : ""}`;
}

/** 4500 → "4.5", 3000 → "3". */
export function formatQuantity(milli: number): string {
  const sign = milli < 0 ? "-" : "";
  const abs = Math.abs(milli);
  const fraction = String(abs % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return `${sign}${GROUPED.format(Math.trunc(abs / 1000))}${fraction ? `.${fraction}` : ""}`;
}

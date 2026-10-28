// Money and quantity parsing/formatting (SPEC 10.1). Integer cents and integer
// thousandths only; strings are parsed digit by digit, never through floats.
// Phase 2 adds line, tax and total calculation here.

const CAD = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });
const GROUPED = new Intl.NumberFormat("en-CA", { useGrouping: true });

/** Splits a typed decimal ("$1,234.5") into sign, integer digits and fraction digits. */
function splitDecimal(input: string): { negative: boolean; whole: string; fraction: string } | null {
  const cleaned = input
    .trim()
    .replace(/^\$/, "")
    .replace(/^(-)\$/, "$1");
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

/** 53467 → "$534.67" (en-CA, CAD). */
export function formatCents(cents: number): string {
  return CAD.format(cents / 100);
}

/** 123456 → "1,234.56": for editable fields, no currency symbol. */
export function formatCentsPlain(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${GROUPED.format(Math.trunc(abs / 100))}.${String(abs % 100).padStart(2, "0")}`;
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

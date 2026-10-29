// CSV for the accountant (FR-RPT-05): UTF-8 with a byte-order mark and CRLF
// line ends so Excel opens it cleanly (₦ and accents intact), amounts as plain
// numbers with two decimals, dates as YYYY-MM-DD.

export type CsvCell = string | number | null | undefined;

/** Kobo as "1234.56" (no grouping, so Excel reads a number). */
export function csvMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function cell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Text that Excel would run as a formula is prefixed (CSV injection);
  // numbers we wrote ourselves ("-12.50") stay numbers.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text) && !/^-\d+(\.\d+)?$/.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  return `\uFEFF${[header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}

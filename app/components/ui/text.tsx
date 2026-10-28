import { BUSINESS_TZ, LOCALE } from "~/domain/locale";
import { formatCents } from "~/domain/money";
import { cn } from "~/lib/utils";

/** Money from integer minor units, en-NG, tabular figures (DS-TYP-02). */
export function MoneyText({ cents, className }: { cents: number; className?: string }) {
  return <span className={cn("tabular", className)}>{formatCents(cents)}</span>;
}

const DATE = new Intl.DateTimeFormat(LOCALE, {
  timeZone: BUSINESS_TZ,
  year: "numeric",
  month: "short",
  day: "numeric",
});

/** A business date in Africa/Lagos (CLAUDE.md). */
export function DateText({ date, className }: { date: Date | string; className?: string }) {
  const value = typeof date === "string" ? new Date(date) : date;
  return (
    <time dateTime={value.toISOString()} className={cn("tabular", className)}>
      {DATE.format(value)}
    </time>
  );
}

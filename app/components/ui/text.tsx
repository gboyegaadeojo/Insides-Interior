import { formatCents } from "~/domain/money";
import { cn } from "~/lib/utils";

/** Money from integer cents, en-CA, tabular figures (DS-TYP-02). */
export function MoneyText({ cents, className }: { cents: number; className?: string }) {
  return <span className={cn("tabular", className)}>{formatCents(cents)}</span>;
}

const DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Winnipeg",
  year: "numeric",
  month: "short",
  day: "numeric",
});

/** A business date in America/Winnipeg (CLAUDE.md). */
export function DateText({ date, className }: { date: Date | string; className?: string }) {
  const value = typeof date === "string" ? new Date(date) : date;
  return (
    <time dateTime={value.toISOString()} className={cn("tabular", className)}>
      {DATE.format(value)}
    </time>
  );
}

import type { LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { cn } from "~/lib/utils";
import { TONE, type ToneName } from "./hue";

/** KPI card: label, figure, detail; tappable to its filtered list (FR-RPT-06). Only a danger tone shows colour (a dot). */
export function KpiCard({
  label,
  value,
  detail,
  tone,
  to,
}: {
  label: string;
  /** Pre-formatted (MoneyText/formatCents); tabular figures. */
  value: string;
  detail?: string;
  tone: ToneName;
  /** Kept for callers; the calm cards show no icon chip. */
  icon?: LucideIcon;
  /** Tappable to the filtered list (SPEC 6.8 Home). */
  to?: string;
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-label font-medium text-secondary">
        {/* Colour only where it carries meaning (premium redesign 2): a dot for danger. */}
        {tone === "danger" && <span className={cn("size-1.5 rounded-full", TONE.danger.base)} aria-hidden />}
        {label}
      </span>
      {/* Scales to the card (container query) so a long naira amount is never cut off. */}
      <span className="mt-2.5 block text-section font-semibold tracking-tight [overflow-wrap:anywhere] tabular @[12rem]:text-title @[16rem]:text-kpi">
        {value}
      </span>
      {detail && <span className="mt-1 block text-label font-normal text-secondary">{detail}</span>}
    </>
  );
  const className =
    "@container relative block overflow-hidden rounded-card border border-border bg-surface p-4 text-primary tablet:p-5";
  return to ? (
    <Link
      to={to}
      className={cn(
        className,
        "transition-[transform,background-color] duration-fast ease-out hover:bg-surface-2/60 active:scale-[0.99]",
      )}
    >
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

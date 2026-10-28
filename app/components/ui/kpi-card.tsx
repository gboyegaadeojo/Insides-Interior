import type { LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { cn } from "~/lib/utils";
import { TONE, type ToneName } from "./hue";
import { IconChip } from "./icon-chip";

/** KPI card with a coloured top edge and icon in its module colour (DS-COL-04/05). */
export function KpiCard({
  label,
  value,
  detail,
  tone,
  icon,
  to,
}: {
  label: string;
  /** Pre-formatted (MoneyText/formatCents); tabular figures. */
  value: string;
  detail?: string;
  tone: ToneName;
  icon: LucideIcon;
  /** Tappable to the filtered list (SPEC 6.8 Home). */
  to?: string;
}) {
  const body = (
    <>
      <span className={cn("absolute inset-x-0 top-0 h-1", TONE[tone].base)} aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <span className="text-label font-semibold text-secondary">{label}</span>
        <IconChip icon={icon} tone={tone} size="sm" />
      </div>
      <span className="mt-3 block text-kpi font-[650] tabular">{value}</span>
      {detail && <span className="mt-1 block text-label font-normal text-secondary">{detail}</span>}
    </>
  );
  const className =
    "relative block overflow-hidden rounded-card border border-border bg-surface p-5 text-primary shadow-card";
  return to ? (
    <Link
      to={to}
      className={cn(
        className,
        "transition-transform duration-fast ease-out hover:-translate-y-0.5 active:scale-[0.99]",
      )}
    >
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

import { cn } from "~/lib/utils";

/** Three-colour project bar (SPEC 6.8): paid Sage, invoiced Indigo, remaining neutral, with words too. */
export function ProjectProgressBar({
  paidPct,
  invoicedUnpaidPct,
  remainingPct,
  className,
}: {
  paidPct: number;
  invoicedUnpaidPct: number;
  remainingPct: number;
  className?: string;
}) {
  return (
    <div className={className}>
      <div
        className="flex h-2.5 overflow-hidden rounded-full bg-surface-3"
        role="img"
        aria-label={`${paidPct}% paid, ${invoicedUnpaidPct}% invoiced and unpaid, ${remainingPct}% left to bill`}
      >
        <span className="bg-sage-base" style={{ width: `${paidPct}%` }} />
        <span className="bg-indigo-base" style={{ width: `${invoicedUnpaidPct}%` }} />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-micro text-secondary" aria-hidden>
        <Legend className="bg-sage-base" label={`Paid ${paidPct}%`} />
        <Legend className="bg-indigo-base" label={`Invoiced ${invoicedUnpaidPct}%`} />
        <Legend className="bg-surface-3" label={`To bill ${remainingPct}%`} />
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("size-2 rounded-full", className)} />
      {label}
    </span>
  );
}

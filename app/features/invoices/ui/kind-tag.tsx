import { formatBp } from "~/domain/money";
import { cn } from "~/lib/utils";

type Kind = "standard" | "deposit" | "progress" | "final";

const KIND: Record<Kind, { label: string; tone: string }> = {
  deposit: { label: "Deposit", tone: "bg-ocean-tint text-ocean-ink" },
  progress: { label: "Progress", tone: "bg-indigo-tint text-indigo-ink" },
  final: { label: "Final", tone: "bg-plum-tint text-plum-ink" },
  standard: { label: "Full", tone: "bg-slate-tint text-slate-ink" },
};

/**
 * Which part of a job an invoice or payment is for (owner request): "Deposit
 * 85% · Q-1004", "Final · Q-1004". Nothing for an invoice not from a quote.
 */
export function InvoiceKindTag({
  kind,
  quoteNumber,
  depositBp,
  className,
}: {
  kind: Kind;
  quoteNumber: string | null;
  depositBp?: number | null;
  className?: string;
}) {
  if (!quoteNumber && kind === "standard") return null;
  const { label, tone } = KIND[kind];
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-micro font-semibold whitespace-nowrap",
        tone,
        className,
      )}
    >
      {label}
      {kind === "deposit" && depositBp ? ` ${formatBp(depositBp)}%` : ""}
      {quoteNumber && <span className="font-normal">· {quoteNumber}</span>}
    </span>
  );
}

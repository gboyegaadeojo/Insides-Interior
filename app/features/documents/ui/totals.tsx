import { ChevronUp } from "lucide-react";
import * as React from "react";
import { Sheet, SheetContent } from "~/components/ui/sheet";
import { MoneyText } from "~/components/ui/text";
import type { DocumentTotals } from "~/domain/document";
import { formatBp } from "~/domain/money";
import { cn } from "~/lib/utils";

/** Totals card (SPEC 6.8): subtotal, discounts, each tax with its rate, total, deposit and balance. */
export function TotalsBreakdown({ totals, depositLabel }: { totals: DocumentTotals; depositLabel?: string }) {
  const { computed } = totals;
  const row = "flex items-baseline justify-between gap-4 py-1.5";
  return (
    <dl className="tabular" aria-label="Totals">
      <div className={row}>
        <dt className="text-secondary">Subtotal</dt>
        <dd>
          <MoneyText cents={computed.subtotalCents} />
        </dd>
      </div>
      {computed.discountCents > 0 && (
        <div className={row}>
          <dt className="text-secondary">Discounts</dt>
          <dd>
            −<MoneyText cents={computed.discountCents} />
          </dd>
        </div>
      )}
      {computed.taxes.map((tax) => (
        <div key={tax.rateId} className={row}>
          <dt className="text-secondary">
            {tax.name} {formatBp(tax.rateBp)}%
          </dt>
          <dd>
            <MoneyText cents={tax.taxCents} />
          </dd>
        </div>
      ))}
      {totals.hasOptions && (
        <div className={row}>
          <dt className="text-secondary">Base total (no options)</dt>
          <dd>
            <MoneyText cents={totals.baseTotalCents} />
          </dd>
        </div>
      )}
      <div className={cn(row, "mt-1 border-t border-border pt-3 text-section font-semibold")}>
        <dt>{totals.hasOptions ? "Total with selected options" : "Total"}</dt>
        <dd data-testid="quote-total">
          <MoneyText cents={computed.totalCents} />
        </dd>
      </div>
      {totals.depositCents > 0 && (
        <>
          <div className={row}>
            <dt className="text-secondary">Deposit{depositLabel ? ` (${depositLabel})` : ""}</dt>
            <dd>
              <MoneyText cents={totals.depositCents} />
            </dd>
          </div>
          <div className={row}>
            <dt className="text-secondary">Balance due</dt>
            <dd>
              <MoneyText cents={totals.balanceCents} />
            </dd>
          </div>
        </>
      )}
    </dl>
  );
}

/**
 * Sticky bottom total bar for tablet portrait and phone (DS-TCH-02): always
 * visible while editing; tap for the full breakdown.
 */
export function TotalBar({ totals, depositLabel }: { totals: DocumentTotals; depositLabel?: string }) {
  const [open, setOpen] = React.useState(false);
  const { computed } = totals;
  return (
    <>
      <div className="fixed inset-x-0 bottom-[calc(var(--tabbar-height)+env(safe-area-inset-bottom))] z-20 border-t border-border bg-surface px-[var(--gutter)] py-2 shadow-sheet tablet:bottom-0 tablet:pb-[max(env(safe-area-inset-bottom),0.5rem)] tablet:pl-[calc(var(--rail-collapsed)+var(--gutter))] wide:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-h-12 w-full items-center gap-4 text-left"
          aria-label="Show the totals breakdown"
        >
          <span className="flex flex-1 flex-wrap gap-x-4 text-label font-normal text-secondary tabular">
            <span>
              Subtotal{" "}
              <MoneyText cents={computed.subtotalCents - computed.discountCents} className="text-primary" />
            </span>
            <span>
              Tax <MoneyText cents={computed.taxCents} className="text-primary" />
            </span>
          </span>
          <span className="text-right">
            <span className="block text-micro text-secondary">Total</span>
            <MoneyText cents={computed.totalCents} className="text-section font-semibold" />
          </span>
          <ChevronUp className="size-5 text-secondary" aria-hidden />
        </button>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title="Totals">
          <TotalsBreakdown totals={totals} depositLabel={depositLabel} />
        </SheetContent>
      </Sheet>
    </>
  );
}

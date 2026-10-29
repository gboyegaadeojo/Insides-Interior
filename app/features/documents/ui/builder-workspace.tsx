import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ChevronRight, Plus } from "lucide-react";
import * as React from "react";
import { useBlocker, useRevalidator } from "react-router";
import { Paper } from "~/components/doc/paper";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { TextField, Textarea } from "~/components/ui/field";
import { MoneyField } from "~/components/ui/number-fields";
import { SegmentedControl } from "~/components/ui/segmented-control";
import type { DocumentTotals } from "~/domain/document";
import { formatBp, parseMoneyToCents } from "~/domain/money";
import { useMediaQuery } from "~/lib/use-media-query";
import { cn } from "~/lib/utils";
import { type BuilderItem, type BuilderTemplate, CatalogueSheet } from "./catalogue-sheet";
import { RoomOutline } from "./room-outline";
import { SectionCard, useDragSensors } from "./section-card";
import { TotalBar, TotalsBreakdown } from "./totals";
import type { Discount, DraftSection, SectionAction } from "./use-draft";

/**
 * The document builder below the header bar, shared by quotes and invoices
 * (SPEC 6.8 builder): rooms and lines with drag and Move up/down, the whole-
 * document discount, notes and terms, totals, the live preview (side by side
 * from tablet landscape, a tab below), the sticky total bar, the catalogue
 * sheet and the leave-before-saved guard.
 */
export function BuilderWorkspace({
  noun,
  header,
  sections,
  documentDiscount,
  notes,
  terms,
  dispatch,
  totals,
  taxRates,
  depositLabel,
  preview,
  dirty,
  conflict,
  onOverwrite,
  catalogue,
}: {
  /** "quote" or "invoice", for the wording. */
  noun: string;
  /** Details card(s) at the top of the editor. */
  header: React.ReactNode;
  sections: DraftSection[];
  documentDiscount?: Discount;
  notes?: string;
  terms?: string;
  dispatch: (action: SectionAction) => void;
  totals: DocumentTotals;
  taxRates: { id: string; name: string; rateBp: number }[];
  depositLabel?: string;
  /** The DocumentRenderer for the live preview. */
  preview: React.ReactNode;
  dirty: boolean;
  conflict: boolean;
  onOverwrite: () => void;
  catalogue: { items: BuilderItem[]; templates: BuilderTemplate[]; defaultTaxIds: string[] };
}) {
  const [view, setView] = React.useState<"edit" | "preview">("edit");
  const [addingTo, setAddingTo] = React.useState<string | null>(null);
  const sensors = useDragSensors();
  const revalidator = useRevalidator();
  // Ledger rows from tablet up; two-line rows that open in place on a phone.
  const wide = useMediaQuery("(min-width: 744px)");
  const [notesOpen, setNotesOpen] = React.useState(false);

  // Leave-page confirmation unless the draft is safely saved (SPEC 6.8 builder).
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function onSectionDragEnd(event: DragEndEvent) {
    const from = sections.findIndex((s) => s.id === event.active.id);
    const to = sections.findIndex((s) => s.id === event.over?.id);
    if (from >= 0 && to >= 0) dispatch({ type: "moveSection", from, to });
  }

  const editor = (
    <div className="flex flex-col gap-5">
      {header}
      <RoomOutline sections={sections} totals={totals} dispatch={dispatch} />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onSectionDragEnd}>
        <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="-mt-2 flex flex-col gap-4">
            {sections.map((section, i) => (
              <SectionCard
                key={section.id}
                section={section}
                index={i}
                count={sections.length}
                totals={totals}
                taxRates={taxRates}
                dispatch={dispatch}
                onAddLine={setAddingTo}
                wide={wide}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <Button
        type="button"
        variant="ghost"
        className="self-start font-semibold text-accent hover:bg-accent-tint"
        onClick={() =>
          dispatch({
            type: "addSection",
            section: { id: crypto.randomUUID(), title: `Room ${sections.length + 1}`, lines: [] },
          })
        }
      >
        <Plus aria-hidden />
        Add room
      </Button>
      <section aria-labelledby="summary-heading" className="flex flex-col gap-2.5">
        <h2 id="summary-heading" className="px-1 text-label font-semibold text-secondary">
          Summary
        </h2>
        <div className="rounded-card border border-border bg-surface px-4 py-2">
          <DocumentDiscountField noun={noun} discount={documentDiscount} dispatch={dispatch} />
          <TotalsBreakdown totals={totals} depositLabel={depositLabel} />
        </div>
        <div className="overflow-hidden rounded-card border border-border bg-surface">
          <button
            type="button"
            aria-expanded={notesOpen}
            onClick={() => setNotesOpen((o) => !o)}
            className="flex min-h-13 w-full items-center gap-3 px-4 text-left hover:bg-surface-2/60"
          >
            <span className="shrink-0 font-medium">Notes and terms</span>
            <span className="min-w-0 flex-1 truncate text-label text-secondary">
              {firstLine(notes || terms) || "Lead times, what's included, payment terms"}
            </span>
            <ChevronRight
              className={cn(
                "size-4 shrink-0 text-tertiary transition-transform duration-standard",
                notesOpen && "rotate-90",
              )}
              aria-hidden
            />
          </button>
          {notesOpen && (
            <div className="flex flex-col gap-4 border-t border-border p-4">
              <Textarea
                label="Notes"
                value={notes ?? ""}
                onChange={(e) => dispatch({ type: "text", field: "notes", value: e.target.value })}
                hint="Lead times, what's included"
              />
              <Textarea
                label="Terms"
                value={terms ?? ""}
                onChange={(e) => dispatch({ type: "text", field: "terms", value: e.target.value })}
                className="min-h-32"
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );

  return (
    <>
      {conflict && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-card border border-saffron-base bg-saffron-tint p-4 text-saffron-ink tablet:flex-row tablet:items-center"
        >
          <p className="flex-1 font-semibold">
            A newer version of this {noun} was saved in another tab or device. Your latest changes aren't
            saved.
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => revalidator.revalidate().then(() => window.location.reload())}
          >
            Load the newer version
          </Button>
          <Button type="button" onClick={onOverwrite}>
            Keep mine
          </Button>
        </div>
      )}

      <SegmentedControl
        label="Edit or preview"
        className="wide:hidden"
        value={view}
        onValueChange={setView}
        segments={[
          { value: "edit", label: "Edit" },
          { value: "preview", label: "Preview" },
        ]}
      />

      {/* Tablet landscape 58/42 keeps room to edit; desktop splits evenly so the preview stays legible. */}
      <div className="wide:grid wide:grid-cols-[minmax(0,58fr)_minmax(0,42fr)] wide:items-start wide:gap-6 desktop:grid-cols-2">
        <div className={cn(view === "preview" && "hidden wide:block")}>{editor}</div>
        <aside
          aria-label="Live preview"
          className={cn(
            "rounded-sheet bg-surface-3/70 p-3 tablet:p-6 wide:sticky wide:top-20 desktop:p-5",
            view === "edit" && "hidden wide:block",
          )}
        >
          <Paper>{preview}</Paper>
        </aside>
      </div>

      <TotalBar totals={totals} depositLabel={depositLabel} />

      <CatalogueSheet
        open={addingTo !== null}
        onOpenChange={(open) => !open && setAddingTo(null)}
        items={catalogue.items}
        templates={catalogue.templates}
        defaultTaxIds={catalogue.defaultTaxIds}
        onAddLines={(lines) => addingTo && dispatch({ type: "addLines", sectionId: addingTo, lines })}
        onAddSection={(section) => dispatch({ type: "addSection", section })}
        noun={noun}
      />
      <ConfirmDialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => !open && blocker.state === "blocked" && blocker.reset()}
        title="Leave before it's saved?"
        description={`Your latest changes to this ${noun} haven't been saved yet.`}
        confirmLabel="Leave anyway"
        cancelLabel="Stay"
        destructive
        onConfirm={() => {
          if (blocker.state === "blocked") blocker.proceed();
        }}
      />
    </>
  );
}

function firstLine(text: string | undefined) {
  return (text ?? "").split(/\r?\n/)[0]?.trim() ?? "";
}

function DocumentDiscountField({
  noun,
  discount,
  dispatch,
}: {
  noun: string;
  discount?: Discount;
  dispatch: (action: SectionAction) => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-border py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-secondary">Discount on the whole {noun}</span>
        <SegmentedControl
          label="Document discount"
          value={discount?.type ?? "none"}
          onValueChange={(mode) =>
            dispatch({
              type: "documentDiscount",
              discount:
                mode === "none"
                  ? undefined
                  : mode === "percent"
                    ? { type: "percent", bp: 1000 }
                    : { type: "amount", cents: 0 },
            })
          }
          segments={[
            { value: "none", label: "None" },
            { value: "percent", label: "%" },
            { value: "amount", label: "₦" },
          ]}
        />
      </div>
      {discount?.type === "percent" && (
        <TextField
          label="Discount (%)"
          inputMode="decimal"
          defaultValue={formatBp(discount.bp)}
          key={`dd-${discount.bp}`}
          onBlur={(e) => {
            const bp = parseMoneyToCents(e.target.value.replace(/%$/, ""));
            if (bp !== null)
              dispatch({
                type: "documentDiscount",
                discount: { type: "percent", bp: Math.min(10_000, Math.max(0, bp)) },
              });
          }}
          fieldClassName="max-w-40"
          className="text-right tabular"
          hint="Shared across lines before tax"
        />
      )}
      {discount?.type === "amount" && (
        <div className="max-w-56">
          <MoneyField
            label="Discount"
            value={discount.cents}
            onValueChange={(v) =>
              dispatch({ type: "documentDiscount", discount: { type: "amount", cents: v ?? 0 } })
            }
            hint="Shared across lines before tax"
          />
        </div>
      )}
    </div>
  );
}

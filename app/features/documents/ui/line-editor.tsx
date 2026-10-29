import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, ChevronDown, Ellipsis, GripVertical, Lock, Trash2 } from "lucide-react";
import * as React from "react";
import { Button } from "~/components/ui/button";
import { TextField } from "~/components/ui/field";
import { ItemTypeChip } from "~/components/ui/item-type-chip";
import { MoneyField, QuantityField } from "~/components/ui/number-fields";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { Skeleton } from "~/components/ui/states";
import { MoneyText } from "~/components/ui/text";
import {
  formatBp,
  formatCents,
  formatCentsPlain,
  formatQuantity,
  lineAmountCents,
  parseMoneyToCents,
} from "~/domain/money";
import type { ComputedLine } from "~/domain/tax";
import { richTextToPlain } from "~/lib/rich-text";
import { cn } from "~/lib/utils";
import type { DraftLine, SectionAction } from "./use-draft";

// Tiptap only runs in the browser and only once a line's options are open, so
// it loads on demand and stays out of the Worker bundle (CPU limit, error 1102).
const RichTextField = React.lazy(() =>
  import("~/components/ui/rich-text-field").then((m) => ({ default: m.RichTextField })),
);

/**
 * Ledger layout (premium redesign 2), sized by the room (container query):
 * handle · item · figures · options on one row in a wide room; in a narrower
 * one (the editor beside the preview on iPad) the item takes the full width
 * and the figures sit on a second row under it, right-aligned. The room's
 * column header uses the same places, so the headings line up either way.
 */
export const LEDGER_GRID =
  "grid grid-cols-[2.25rem_minmax(0,1fr)_2.75rem] items-center gap-x-1.5 @[44rem]:grid-cols-[2.25rem_minmax(0,1fr)_auto_2.75rem]";
export const LEDGER_ITEM = "col-start-2 row-start-1 min-w-0";
export const LEDGER_FIGURES =
  "col-start-2 row-start-2 justify-self-end grid grid-cols-[4.25rem_3rem_7rem_6.5rem] items-center gap-x-1 @[44rem]:col-start-3 @[44rem]:row-start-1";
export const LEDGER_MENU = "col-start-3 row-start-1 @[44rem]:col-start-4";

const menuButton =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-control text-tertiary hover:bg-surface-2 hover:text-primary aria-expanded:bg-surface-2 aria-expanded:text-primary";

const optionalChip =
  "inline-flex h-[22px] shrink-0 items-center rounded-full border border-tertiary/45 px-2 text-label leading-none font-semibold text-secondary";

/**
 * One line of a room. From tablet up it's a single ledger row edited in place;
 * on a phone it's a two-line summary ("2 each × ₦5,000") that opens in place
 * to edit. Its options (details, taxes, discount, optional, move, remove) open
 * below the row from the "⋯" button.
 */
export function LineEditor({
  line,
  index,
  count,
  sectionId,
  computed,
  taxRates,
  dispatch,
  wide,
}: {
  line: DraftLine;
  index: number;
  count: number;
  sectionId: string;
  computed?: ComputedLine;
  taxRates: { id: string; name: string; rateBp: number }[];
  dispatch: (action: SectionAction) => void;
  /** Ledger row (tablet and up) or phone summary row. */
  wide: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  // A new, empty line opens on a phone so it can be typed straight away.
  const [editing, setEditing] = React.useState(line.description === "");
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: line.id });
  const update = (patch: Partial<DraftLine>) =>
    dispatch({ type: "updateLine", sectionId, lineId: line.id, patch });
  const name = line.description || "this line";
  const excluded = !!line.optional && !line.selected;
  // An optional item not chosen shows what it would cost, in grey (it is not in the total).
  const amountCents = excluded
    ? lineAmountCents(line.qtyMilli, line.unitPriceCents)
    : (computed?.netCents ?? 0);
  const details = line.details ? richTextToPlain(line.details) : "";

  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={`Drag to reorder ${name}`}
      className="inline-flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-control text-tertiary opacity-40 transition-opacity group-hover:opacity-100 hover:bg-surface-2 focus-visible:opacity-100 active:cursor-grabbing pointer-coarse:opacity-70"
    >
      <GripVertical className="size-4" aria-hidden />
    </button>
  );

  // Billed portions, approved quote lines and credits come from the server and
  // are shown read only, so the amounts always reconcile (SPEC 10.2).
  if (line.locked) {
    return (
      <li
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={cn("group bg-surface-2/40", isDragging && "relative z-10 shadow-sheet")}
      >
        <div className="flex min-h-14 items-center gap-1.5 py-1.5 pr-4 pl-1">
          {handle}
          <div className="min-w-0 flex-1">
            <p className="font-medium">{line.description}</p>
            <p className="flex items-center gap-1.5 text-label text-secondary">
              <Lock className="size-3.5" aria-hidden />
              From the approved quote; can't be edited here
            </p>
          </div>
          <MoneyText cents={computed?.netCents ?? 0} className="shrink-0 font-semibold" />
        </div>
      </li>
    );
  }

  const description = (cell: boolean) => (
    <TextField
      label="Description"
      hideLabel={cell}
      cell={cell}
      value={line.description}
      onChange={(e) => update({ description: e.target.value })}
      placeholder={cell ? "Describe the item" : "e.g. Drapery fabric"}
      className={cn(cell && "font-medium")}
    />
  );
  const qty = (cell: boolean) => (
    <QuantityField
      label="Qty"
      hideLabel={cell}
      cell={cell}
      value={line.qtyMilli}
      onValueChange={(v) => update({ qtyMilli: v ?? 0 })}
    />
  );
  const unit = (cell: boolean) => (
    <TextField
      label="Unit"
      hideLabel={cell}
      cell={cell}
      value={line.unit}
      onChange={(e) => update({ unit: e.target.value })}
      className={cn(cell && "px-1 text-secondary")}
    />
  );
  const price = (cell: boolean) => (
    <MoneyField
      label="Price"
      hideLabel={cell}
      cell={cell}
      value={line.unitPriceCents}
      onValueChange={(v) => update({ unitPriceCents: v ?? 0 })}
    />
  );
  const optionsButton = (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      aria-label={open ? `Fewer options for ${name}` : `More options for ${name}`}
      className={menuButton}
    >
      <Ellipsis className="size-4.5" aria-hidden />
    </button>
  );

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group bg-surface transition-colors duration-fast",
        (open || (!wide && editing)) && "bg-surface-2/40",
        isDragging && "relative z-10 shadow-sheet",
      )}
    >
      {wide ? (
        <div className={cn(LEDGER_GRID, "min-h-14 py-1.5 pr-1 pl-1")}>
          <div className="col-start-1 row-start-1">{handle}</div>
          <div className={LEDGER_ITEM}>
            {description(true)}
            {(details || line.itemType || line.optional) && (
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 pb-1">
                {line.itemType && <ItemTypeChip type={line.itemType} />}
                {line.optional && <span className={optionalChip}>Optional</span>}
                {details && <span className="min-w-0 truncate text-label text-secondary">{details}</span>}
              </div>
            )}
          </div>
          <div className={LEDGER_FIGURES}>
            {qty(true)}
            {unit(true)}
            {price(true)}
            <span
              className={cn("pr-2 text-right tabular", excluded ? "text-secondary" : "font-semibold")}
              aria-live="polite"
            >
              {formatCentsPlain(amountCents)}
            </span>
          </div>
          <div className={LEDGER_MENU}>{optionsButton}</div>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            aria-expanded={editing}
            aria-label={`Edit ${name}`}
            className="flex min-h-16 w-full items-center gap-3 py-2 pr-3 pl-4 text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-2 font-medium">
                <span className="truncate">{line.description || "New line"}</span>
                {line.optional && <span className={optionalChip}>Optional</span>}
              </span>
              <span className="block truncate text-label text-secondary tabular">
                {formatQuantity(line.qtyMilli)} {line.unit} × {formatCents(line.unitPriceCents)}
              </span>
            </span>
            <MoneyText cents={amountCents} className={cn(excluded ? "text-secondary" : "font-semibold")} />
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-tertiary transition-transform duration-standard",
                editing && "rotate-180",
              )}
              aria-hidden
            />
          </button>
          {editing && (
            <div className="grid grid-cols-2 gap-3 px-4 pb-4">
              <div className="col-span-2">{description(false)}</div>
              {qty(false)}
              {unit(false)}
              <div className="col-span-2 flex items-end gap-2">
                <div className="flex-1">{price(false)}</div>
                {handle}
                {optionsButton}
              </div>
            </div>
          )}
        </>
      )}

      {open && (
        <div className={cn("flex flex-col gap-4 border-t border-border py-4 pr-4", wide ? "pl-12" : "pl-4")}>
          <React.Suspense
            fallback={
              <div className="flex flex-col gap-1.5">
                <span className="text-label font-medium text-secondary">Details</span>
                <Skeleton className="h-30" />
              </div>
            }
          >
            <RichTextField
              label="Details"
              value={line.details ?? ""}
              onChange={(html) => update({ details: html || undefined })}
              placeholder="Fabric, finish, lining…"
            />
          </React.Suspense>
          {taxRates.length > 0 && (
            <fieldset>
              <legend className="mb-1.5 text-label font-medium text-secondary">Taxes</legend>
              <div className="flex flex-wrap gap-2">
                {taxRates.map((rate) => (
                  <label
                    key={rate.id}
                    className="flex min-h-11 items-center gap-2 rounded-control border border-border bg-surface px-3"
                  >
                    <input
                      type="checkbox"
                      checked={line.taxRateIds.includes(rate.id)}
                      onChange={(e) =>
                        update({
                          taxRateIds: e.target.checked
                            ? [...line.taxRateIds, rate.id]
                            : line.taxRateIds.filter((t) => t !== rate.id),
                        })
                      }
                      className="size-5 accent-[var(--accent)]"
                    />
                    {rate.name} <span className="text-secondary tabular">{formatBp(rate.rateBp)}%</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div className="flex flex-col gap-2">
            <SegmentedControl
              label={`Discount on ${name}`}
              value={line.discount?.type ?? "none"}
              onValueChange={(mode) =>
                update({
                  discount:
                    mode === "none"
                      ? undefined
                      : mode === "percent"
                        ? { type: "percent", bp: 1000 }
                        : { type: "amount", cents: 0 },
                })
              }
              segments={[
                { value: "none", label: "No discount" },
                { value: "percent", label: "%" },
                { value: "amount", label: "₦" },
              ]}
            />
            {line.discount?.type === "percent" && (
              <TextField
                label="Discount (%)"
                inputMode="decimal"
                defaultValue={formatBp(line.discount.bp)}
                onBlur={(e) => {
                  const bp = parseMoneyToCents(e.target.value.replace(/%$/, ""));
                  if (bp !== null)
                    update({ discount: { type: "percent", bp: Math.min(10_000, Math.max(0, bp)) } });
                }}
                className="max-w-32 text-right tabular"
              />
            )}
            {line.discount?.type === "amount" && (
              <div className="max-w-48">
                <MoneyField
                  label="Discount"
                  value={line.discount.cents}
                  onValueChange={(v) => update({ discount: { type: "amount", cents: v ?? 0 } })}
                />
              </div>
            )}
          </div>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={line.optional ?? false}
              onChange={(e) =>
                update({ optional: e.target.checked, selected: e.target.checked ? false : undefined })
              }
              className="size-5 accent-[var(--accent)]"
            />
            <span>
              <span className="font-medium">Optional item</span>
              <span className="block text-label font-normal text-secondary">
                Left out of the total until the client chooses it
              </span>
            </span>
          </label>
          {line.optional && (
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={line.selected ?? false}
                onChange={(e) => update({ selected: e.target.checked })}
                className="size-5 accent-[var(--accent)]"
              />
              Include it in the preview total
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={index === 0}
              onClick={() => dispatch({ type: "moveLine", sectionId, from: index, to: index - 1 })}
            >
              <ArrowUp aria-hidden />
              Move up
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={index === count - 1}
              onClick={() => dispatch({ type: "moveLine", sectionId, from: index, to: index + 1 })}
            >
              <ArrowDown aria-hidden />
              Move down
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-danger-ink"
              onClick={() => dispatch({ type: "removeLine", sectionId, lineId: line.id })}
            >
              <Trash2 aria-hidden />
              Remove line
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

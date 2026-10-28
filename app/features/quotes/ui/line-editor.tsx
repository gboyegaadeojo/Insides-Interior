import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, Trash2 } from "lucide-react";
import * as React from "react";
import { Button } from "~/components/ui/button";
import { TextField } from "~/components/ui/field";
import { ItemTypeChip } from "~/components/ui/item-type-chip";
import { MoneyField, QuantityField } from "~/components/ui/number-fields";
import { RichTextField } from "~/components/ui/rich-text-field";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { MoneyText } from "~/components/ui/text";
import { formatBp, parseMoneyToCents } from "~/domain/money";
import type { ComputedLine } from "~/domain/tax";
import { cn } from "~/lib/utils";
import type { DraftAction, DraftLine } from "./use-draft";

export function LineEditor({
  line,
  index,
  count,
  sectionId,
  computed,
  taxRates,
  dispatch,
}: {
  line: DraftLine;
  index: number;
  count: number;
  sectionId: string;
  computed?: ComputedLine;
  taxRates: { id: string; name: string; rateBp: number }[];
  dispatch: (action: DraftAction) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: line.id });
  const update = (patch: Partial<DraftLine>) =>
    dispatch({ type: "updateLine", sectionId, lineId: line.id, patch });
  const discountMode = line.discount?.type ?? "none";
  const name = line.description || "this line";

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "rounded-card border bg-surface",
        line.optional ? "border-dashed border-tertiary" : "border-border",
        isDragging && "relative z-10 shadow-sheet",
      )}
    >
      <div className="flex gap-1 p-2">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder ${name}`}
          className="inline-flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-control text-secondary hover:bg-surface-2 active:cursor-grabbing"
        >
          <GripVertical className="size-5" aria-hidden />
        </button>
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 @lg:grid-cols-[minmax(0,1fr)_6rem_5rem_7.5rem_6.5rem]">
          <div className="col-span-2 @lg:col-span-1">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              {line.itemType && <ItemTypeChip type={line.itemType} />}
              {line.optional && (
                <span className="rounded-full bg-surface-3 px-2 py-0.5 text-micro font-semibold">
                  Optional
                </span>
              )}
            </div>
            <TextField
              label="Description"
              value={line.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="e.g. Drapery fabric"
            />
          </div>
          <QuantityField
            label="Qty"
            value={line.qtyMilli}
            onValueChange={(v) => update({ qtyMilli: v ?? 0 })}
          />
          <TextField label="Unit" value={line.unit} onChange={(e) => update({ unit: e.target.value })} />
          <MoneyField
            label="Price"
            value={line.unitPriceCents}
            onValueChange={(v) => update({ unitPriceCents: v ?? 0 })}
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-label font-semibold">Amount</span>
            <span className="flex h-11 items-center justify-end" aria-live="polite">
              <MoneyText
                cents={computed?.included === false ? 0 : (computed?.netCents ?? 0)}
                className="font-semibold"
              />
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? `Fewer options for ${name}` : `More options for ${name}`}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-secondary hover:bg-surface-2"
        >
          <ChevronDown
            className={cn("size-5 transition-transform duration-standard", open && "rotate-180")}
            aria-hidden
          />
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-4 border-t border-border p-3">
          <RichTextField
            label="Details"
            value={line.details ?? ""}
            onChange={(html) => update({ details: html || undefined })}
            placeholder="Fabric, finish, lining…"
          />
          <fieldset>
            <legend className="mb-1.5 text-label font-semibold">Taxes</legend>
            <div className="flex flex-wrap gap-2">
              {taxRates.map((rate) => (
                <label
                  key={rate.id}
                  className="flex min-h-11 items-center gap-2 rounded-control border border-border px-3"
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
                    className="size-5 accent-[var(--teal-base)]"
                  />
                  {rate.name} <span className="text-secondary tabular">{formatBp(rate.rateBp)}%</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col gap-2">
            <SegmentedControl
              label={`Discount on ${name}`}
              value={discountMode}
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
                { value: "amount", label: "$" },
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
              className="size-5 accent-[var(--teal-base)]"
            />
            <span>
              <span className="font-semibold">Optional item</span>
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
                className="size-5 accent-[var(--teal-base)]"
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

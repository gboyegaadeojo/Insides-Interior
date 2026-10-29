import * as React from "react";
import { Select, TextField, Textarea } from "~/components/ui/field";
import { MoneyField } from "~/components/ui/number-fields";
import { formatBp, formatCentsPlain, parseMoneyToCents } from "~/domain/money";
import { markupFromPrice, priceFromMarkup } from "~/domain/pricing";
import type { FieldErrors } from "~/lib/form";
import { cn } from "~/lib/utils";
import { ITEM_TYPES, UNITS } from "../schema";
import { ItemTypeChip } from "~/components/ui/item-type-chip";

const UNIT_LABEL: Record<(typeof UNITS)[number], string> = {
  each: "Each",
  hour: "Hour",
  "sq ft": "Square foot",
  "linear ft": "Linear foot",
  yard: "Yard",
  roll: "Roll",
  set: "Set",
  job: "Job (fixed price)",
};

export interface ItemFormValues {
  type?: (typeof ITEM_TYPES)[number];
  name?: string;
  description?: string | null;
  unit?: string;
  priceCents?: number | null;
  costCents?: number | null;
  supplier?: string | null;
  sku?: string | null;
  defaultTaxIds?: string[];
}

/**
 * Catalogue item fields (FR-CAT-01…06). Price, cost and markup stay in sync:
 * editing the markup sets the price; editing the price recomputes the markup
 * (FR-CAT-02). Cost and markup are internal and never shown to clients.
 */
export function ItemFields({
  values = {},
  errors = {},
  taxRates,
}: {
  values?: ItemFormValues;
  errors?: FieldErrors;
  taxRates: { id: string; name: string; rateBp: number; isDefault: boolean }[];
}) {
  const [type, setType] = React.useState(values.type ?? "service");
  const [price, setPrice] = React.useState<number | null>(values.priceCents ?? null);
  const [cost, setCost] = React.useState<number | null>(values.costCents ?? null);
  const markup = cost && price !== null ? markupFromPrice(cost, price) : null;
  const [markupText, setMarkupText] = React.useState(markup === null ? "" : formatBp(markup));
  const [markupError, setMarkupError] = React.useState<string>();
  const taxDefaults = values.defaultTaxIds ?? taxRates.filter((r) => r.isDefault).map((r) => r.id);

  function syncMarkup(nextPrice: number | null, nextCost: number | null) {
    const m = nextCost && nextPrice !== null ? markupFromPrice(nextCost, nextPrice) : null;
    setMarkupText(m === null ? "" : formatBp(m));
  }

  function applyMarkup() {
    if (markupText.trim() === "") return;
    const bp = parseMoneyToCents(markupText.replace(/%$/, ""));
    if (bp === null) {
      setMarkupError("Enter a percentage like 50");
      return;
    }
    setMarkupError(undefined);
    if (cost) {
      const next = priceFromMarkup(cost, bp);
      setPrice(next);
      setMarkupText(formatBp(markupFromPrice(cost, next) ?? bp));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <fieldset>
        <legend className="mb-1.5 text-label font-semibold">Type</legend>
        <div className="grid grid-cols-2 gap-2 tablet:grid-cols-4">
          {ITEM_TYPES.map((t) => (
            <label
              key={t}
              className={cn(
                "flex min-h-12 cursor-pointer items-center justify-center rounded-control border-2 px-2 transition-colors duration-fast",
                type === t ? "border-accent bg-surface" : "border-border bg-surface-2",
              )}
            >
              <input
                type="radio"
                name="type"
                value={t}
                checked={type === t}
                onChange={() => setType(t)}
                className="sr-only"
              />
              <ItemTypeChip type={t} />
            </label>
          ))}
        </div>
      </fieldset>
      <TextField
        label="Name"
        name="name"
        defaultValue={values.name ?? ""}
        required
        error={errors.name}
        placeholder="e.g. Drapery fabric"
      />
      <Textarea
        label="Description"
        name="description"
        defaultValue={values.description ?? ""}
        hint="Shown to clients on quotes"
        className="min-h-20"
      />
      <div className="grid gap-4 tablet:grid-cols-2">
        <Select label="Unit" name="unit" defaultValue={values.unit ?? (type === "service" ? "hour" : "each")}>
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {UNIT_LABEL[u]}
            </option>
          ))}
        </Select>
        <div>
          <MoneyField
            label="Price (per unit)"
            value={price}
            onValueChange={(v) => {
              setPrice(v);
              syncMarkup(v, cost);
            }}
            error={errors.priceCents}
            required
          />
          <input type="hidden" name="priceCents" value={price === null ? "" : formatCentsPlain(price)} />
        </div>
      </div>
      {type !== "service" && (
        <div className="grid gap-4 rounded-card bg-surface-2 p-3 tablet:grid-cols-2">
          <div>
            <MoneyField
              label="Your cost"
              value={cost}
              onValueChange={(v) => {
                setCost(v);
                syncMarkup(price, v);
              }}
              error={errors.costCents}
              hint="Internal only"
            />
            <input type="hidden" name="costCents" value={cost === null ? "" : formatCentsPlain(cost)} />
          </div>
          <TextField
            label="Markup (%)"
            value={markupText}
            onChange={(e) => setMarkupText(e.target.value)}
            onBlur={applyMarkup}
            inputMode="decimal"
            disabled={!cost}
            hint={cost ? "Changing this sets the price" : "Enter a cost first"}
            error={markupError}
            className="text-right tabular"
          />
        </div>
      )}
      {type === "service" && <input type="hidden" name="costCents" value="" />}
      <fieldset>
        <legend className="mb-1.5 text-label font-semibold">Taxes added by default</legend>
        <div className="flex flex-wrap gap-2">
          {taxRates.map((rate) => (
            <label
              key={rate.id}
              className="flex min-h-11 items-center gap-2 rounded-control border border-border px-3"
            >
              <input
                type="checkbox"
                name="taxIds"
                value={rate.id}
                defaultChecked={taxDefaults.includes(rate.id)}
                className="size-5 accent-[var(--accent)]"
              />
              {rate.name} <span className="text-secondary tabular">{formatBp(rate.rateBp)}%</span>
            </label>
          ))}
          {taxRates.length === 0 && <p className="text-secondary">No tax rates yet. Add them in Settings.</p>}
        </div>
      </fieldset>
      {type === "product" && (
        <div className="grid gap-4 tablet:grid-cols-2">
          <TextField label="Supplier" name="supplier" defaultValue={values.supplier ?? ""} />
          <TextField label="SKU" name="sku" defaultValue={values.sku ?? ""} />
        </div>
      )}
    </div>
  );
}

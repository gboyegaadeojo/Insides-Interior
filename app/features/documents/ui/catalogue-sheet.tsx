import { LayoutTemplate, Library, PencilLine, Search } from "lucide-react";
import * as React from "react";
import { TONE } from "~/components/ui/hue";
import { ItemTypeChip } from "~/components/ui/item-type-chip";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { Sheet, SheetContent } from "~/components/ui/sheet";
import { MoneyText } from "~/components/ui/text";
import { formatQuantity } from "~/domain/money";
import { cn } from "~/lib/utils";
import { HUES } from "~/styles/tokens";
import type { DraftLine, DraftSection } from "./use-draft";

export interface BuilderItem {
  id: string;
  type: "service" | "product" | "fee" | "allowance";
  name: string;
  description: string | null;
  unit: string;
  priceCents: number;
  defaultTaxIds: string[];
  photoUrl: string | null;
}

export interface BuilderTemplate {
  id: string;
  name: string;
  color: string;
  lines: { itemId: string; qtyMilli: number }[];
}

const newId = () => crypto.randomUUID();

/** Copies catalogue values into a line; later catalogue edits never change it (FR-CAT-04). */
export function lineFromItem(item: BuilderItem, qtyMilli = 1000): DraftLine {
  return {
    id: newId(),
    itemId: item.id,
    itemType: item.type,
    description: item.name,
    details: item.description
      ? `<p>${item.description.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</p>`
      : undefined,
    qtyMilli,
    unit: item.unit,
    unitPriceCents: item.priceCents,
    taxRateIds: item.defaultTaxIds,
  };
}

/**
 * Catalogue sheet (SPEC 6.8): search with photos, a custom line, and room
 * templates that add a whole room.
 */
export function CatalogueSheet({
  open,
  onOpenChange,
  items,
  templates,
  defaultTaxIds,
  onAddLines,
  onAddSection,
  noun = "quote",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: BuilderItem[];
  templates: BuilderTemplate[];
  defaultTaxIds: string[];
  onAddLines: (lines: DraftLine[]) => void;
  onAddSection: (section: DraftSection) => void;
  /** "quote" or "invoice", for the title. */
  noun?: string;
}) {
  const [tab, setTab] = React.useState<"items" | "templates">("items");
  const [query, setQuery] = React.useState("");
  const byId = new Map(items.map((i) => [i.id, i]));
  const q = query.trim().toLowerCase();
  const visible = q
    ? items.filter((i) => [i.name, i.description].some((v) => v?.toLowerCase().includes(q)))
    : items;

  function add(lines: DraftLine[]) {
    onAddLines(lines);
    onOpenChange(false);
    setQuery("");
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={`Add to the ${noun}`}
        description="Prices are copied in; editing them here doesn't change your catalogue."
      >
        <SegmentedControl
          label="Add from"
          className="mb-3"
          value={tab}
          onValueChange={setTab}
          segments={[
            { value: "items", label: "Items", count: items.length },
            { value: "templates", label: "Room templates", count: templates.length },
          ]}
        />
        {tab === "items" ? (
          <>
            <button
              type="button"
              onClick={() =>
                add([
                  {
                    id: newId(),
                    description: "",
                    qtyMilli: 1000,
                    unit: "each",
                    unitPriceCents: 0,
                    taxRateIds: defaultTaxIds,
                  },
                ])
              }
              className="mb-3 flex min-h-14 w-full items-center gap-3 rounded-card border border-dashed border-tertiary px-3 text-left hover:bg-surface-2"
            >
              <PencilLine className="size-5 text-teal-base" aria-hidden />
              <span className="font-semibold">Custom line</span>
              <span className="text-label font-normal text-secondary">Type anything, priced by you</span>
            </button>
            <label className="relative mb-3 block">
              <span className="sr-only">Search the catalogue</span>
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-secondary"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your catalogue"
                className="h-11 w-full rounded-control border border-tertiary bg-surface pr-3 pl-10 text-body"
              />
            </label>
            {visible.length === 0 ? (
              <p className="py-6 text-center text-secondary">
                {items.length === 0
                  ? "Your catalogue is empty. Add a custom line instead."
                  : "No items match."}
              </p>
            ) : (
              <ul className="flex flex-col gap-2" aria-label="Catalogue items">
                {visible.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => add([lineFromItem(item)])}
                      className="flex min-h-16 w-full items-center gap-3 rounded-card border border-border bg-surface p-2 text-left hover:bg-surface-2"
                    >
                      <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-control bg-sage-tint">
                        {item.photoUrl ? (
                          <img src={item.photoUrl} alt="" className="size-full object-cover" />
                        ) : (
                          <Library className="size-5 text-sage-base" aria-hidden />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{item.name}</span>
                        <ItemTypeChip type={item.type} />
                      </span>
                      <span className="text-right text-label font-normal">
                        <MoneyText cents={item.priceCents} className="block font-semibold" />/ {item.unit}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : templates.length === 0 ? (
          <p className="py-6 text-center text-secondary">
            No room templates yet. Create them in the Catalogue.
          </p>
        ) : (
          <ul className="grid gap-3 tablet:grid-cols-2" aria-label="Room templates">
            {templates.map((t) => {
              const hue = (HUES as readonly string[]).includes(t.color)
                ? (t.color as (typeof HUES)[number])
                : "sage";
              const lines = t.lines.flatMap((l) => {
                const item = byId.get(l.itemId);
                return item ? [lineFromItem(item, l.qtyMilli)] : [];
              });
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onAddSection({ id: newId(), title: t.name, lines });
                      onOpenChange(false);
                    }}
                    className={cn(
                      "flex min-h-28 w-full flex-col justify-between gap-2 rounded-sheet p-4 text-left",
                      TONE[hue].soft,
                    )}
                  >
                    <LayoutTemplate className="size-6" aria-hidden />
                    <span>
                      <span className="block font-display text-section">{t.name}</span>
                      <span className="block text-label font-normal">
                        Adds a room with {lines.length} item{lines.length === 1 ? "" : "s"}
                        {lines.length > 0 &&
                          `: ${lines
                            .slice(0, 2)
                            .map((l) => `${formatQuantity(l.qtyMilli)} ${l.description}`)
                            .join(", ")}${lines.length > 2 ? "…" : ""}`}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}

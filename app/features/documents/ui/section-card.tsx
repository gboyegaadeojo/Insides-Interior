import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import * as Popover from "@radix-ui/react-popover";
import { ArrowDown, ArrowUp, Ellipsis, GripVertical, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { MoneyText } from "~/components/ui/text";
import type { DocumentTotals } from "~/domain/document";
import { cn } from "~/lib/utils";
import { LEDGER_FIGURES, LEDGER_GRID, LEDGER_ITEM, LineEditor } from "./line-editor";
import type { DraftSection, SectionAction } from "./use-draft";

// A room as one slim ledger group (premium redesign 2, SPEC 6.8 builder): the
// name, item count and subtotal on one row with a "⋯" menu (move, remove), a
// single column header, the lines, and a quiet "Add line" row. Drag handles
// show on hover or focus (and always, faintly, on touch) (FR-QT-01).

export function useDragSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

/** Net total of a room's lines (what the outline chips and header show). */
export function roomTotalCents(section: DraftSection, totals: DocumentTotals) {
  return section.lines.reduce((sum, l) => sum + (totals.byLine.get(l.id)?.netCents ?? 0), 0);
}

export function roomAnchor(sectionId: string) {
  return `room-${sectionId}`;
}

const menuItem =
  "flex min-h-11 w-full items-center gap-3 rounded-[8px] px-3 text-left text-body hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4.5 [&_svg]:text-secondary";

export function SectionCard({
  section,
  index,
  count,
  totals,
  taxRates,
  dispatch,
  onAddLine,
  wide,
}: {
  section: DraftSection;
  index: number;
  count: number;
  totals: DocumentTotals;
  taxRates: { id: string; name: string; rateBp: number }[];
  dispatch: (action: SectionAction) => void;
  onAddLine: (sectionId: string) => void;
  /** Ledger rows (tablet and up) or phone rows. */
  wide: boolean;
}) {
  const sensors = useDragSensors();
  const [menu, setMenu] = React.useState(false);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: section.id });
  const title = section.title || "Untitled room";
  const items = section.lines.length;

  function onDragEnd(event: DragEndEvent) {
    const from = section.lines.findIndex((l) => l.id === event.active.id);
    const to = section.lines.findIndex((l) => l.id === event.over?.id);
    if (from >= 0 && to >= 0) dispatch({ type: "moveLine", sectionId: section.id, from, to });
  }

  function act(action: SectionAction) {
    setMenu(false);
    dispatch(action);
  }

  return (
    <section
      ref={setNodeRef}
      id={roomAnchor(section.id)}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      aria-label={title}
      className={cn(
        "group/room @container scroll-mt-32 overflow-hidden rounded-card border border-border bg-surface",
        isDragging && "relative z-20 shadow-sheet",
      )}
    >
      <div className="flex min-h-14 items-center gap-1 py-1 pr-1 pl-1">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder room ${section.title}`}
          className="inline-flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-control text-tertiary opacity-40 transition-opacity group-hover/room:opacity-100 hover:bg-surface-2 focus-visible:opacity-100 pointer-coarse:opacity-70"
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Room name</span>
          <input
            value={section.title}
            onChange={(e) =>
              dispatch({ type: "renameSection", sectionId: section.id, title: e.target.value })
            }
            placeholder="Room name"
            className="h-11 w-full min-w-0 rounded-[8px] border border-transparent bg-transparent px-2 text-section font-semibold tracking-tight text-primary outline-none hover:bg-surface-2 focus-visible:border-accent focus-visible:bg-surface focus-visible:outline-3 focus-visible:outline-accent-tint"
          />
        </label>
        <span className="hidden shrink-0 text-label text-secondary tablet:inline">
          {items} item{items === 1 ? "" : "s"}
        </span>
        <MoneyText
          cents={roomTotalCents(section, totals)}
          className="shrink-0 px-2 text-body font-semibold tablet:px-3"
        />
        <Popover.Root open={menu} onOpenChange={setMenu}>
          <Popover.Trigger
            aria-label={`Room options for ${title}`}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-secondary hover:bg-surface-2 data-[state=open]:bg-surface-2"
          >
            <Ellipsis className="size-5" aria-hidden />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={4}
              className="z-50 w-56 rounded-card border border-border bg-surface p-1.5 text-primary shadow-sheet"
            >
              <button
                type="button"
                className={menuItem}
                disabled={index === 0}
                aria-label={`Move ${section.title} up`}
                onClick={() => act({ type: "moveSection", from: index, to: index - 1 })}
              >
                <ArrowUp aria-hidden />
                Move up
              </button>
              <button
                type="button"
                className={menuItem}
                disabled={index === count - 1}
                aria-label={`Move ${section.title} down`}
                onClick={() => act({ type: "moveSection", from: index, to: index + 1 })}
              >
                <ArrowDown aria-hidden />
                Move down
              </button>
              <button
                type="button"
                className={cn(menuItem, "text-danger-ink [&_svg]:text-danger-ink")}
                disabled={count <= 1}
                aria-label={`Remove room ${section.title}`}
                onClick={() => act({ type: "removeSection", sectionId: section.id })}
              >
                <Trash2 aria-hidden />
                Remove room
              </button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>

      {wide && items > 0 && (
        <div
          className={cn(
            LEDGER_GRID,
            "border-y border-border bg-surface-2/50 py-1.5 pr-1 pl-1 text-micro font-medium text-secondary",
          )}
          aria-hidden
        >
          <span className={cn(LEDGER_ITEM, "px-2")}>Item</span>
          <span className={cn(LEDGER_FIGURES, "row-start-1")}>
            <span className="col-span-2 px-2 text-right">Qty</span>
            <span className="px-2 text-right">Price</span>
            <span className="pr-2 text-right">Amount</span>
          </span>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={section.lines.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          <ul
            className={cn("divide-y divide-border", !wide && items > 0 && "border-t border-border")}
            aria-label={`Lines in ${section.title}`}
          >
            {section.lines.map((line, i) => (
              <LineEditor
                key={line.id}
                line={line}
                index={i}
                count={section.lines.length}
                sectionId={section.id}
                computed={totals.byLine.get(line.id)}
                taxRates={taxRates}
                dispatch={dispatch}
                wide={wide}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <div className={cn("flex items-center gap-3", items > 0 && "border-t border-border")}>
        <button
          type="button"
          onClick={() => onAddLine(section.id)}
          className="flex min-h-12 items-center gap-2 px-4 font-semibold text-accent hover:bg-surface-2"
        >
          <Plus className="size-4.5" strokeWidth={2.4} aria-hidden />
          Add line
        </button>
        {items === 0 && (
          <span className="hidden text-label text-secondary tablet:inline">
            From your catalogue, a room template or a custom line
          </span>
        )}
      </div>
    </section>
  );
}

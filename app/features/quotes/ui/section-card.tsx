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
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { MoneyText } from "~/components/ui/text";
import type { DocumentTotals } from "~/domain/document";
import { cn } from "~/lib/utils";
import { LineEditor } from "./line-editor";
import type { DraftAction, DraftSection } from "./use-draft";

// Room sections as cards with a header strip (SPEC 6.8 builder), the room name in the
// display serif, a drag handle plus Move up/down (FR-QT-01).

export function useDragSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

export function SectionCard({
  section,
  index,
  count,
  totals,
  taxRates,
  dispatch,
  onAddLine,
}: {
  section: DraftSection;
  index: number;
  count: number;
  totals: DocumentTotals;
  taxRates: { id: string; name: string; rateBp: number }[];
  dispatch: (action: DraftAction) => void;
  onAddLine: (sectionId: string) => void;
}) {
  const sensors = useDragSensors();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: section.id });
  const roomTotal = section.lines.reduce((sum, l) => sum + (totals.byLine.get(l.id)?.netCents ?? 0), 0);

  function onDragEnd(event: DragEndEvent) {
    const from = section.lines.findIndex((l) => l.id === event.active.id);
    const to = section.lines.findIndex((l) => l.id === event.over?.id);
    if (from >= 0 && to >= 0) dispatch({ type: "moveLine", sectionId: section.id, from, to });
  }

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      aria-label={section.title || "Untitled room"}
      className={cn(
        "@container overflow-hidden rounded-card border border-border bg-surface shadow-card",
        isDragging && "relative z-20 shadow-sheet",
      )}
    >
      <div className="flex items-center gap-1 border-b border-border bg-surface-2/60 py-1.5 pr-1.5 pl-1">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder room ${section.title}`}
          className="inline-flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-control text-tertiary hover:bg-surface-3 hover:text-primary"
        >
          <GripVertical className="size-5" aria-hidden />
        </button>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Room name</span>
          <input
            value={section.title}
            onChange={(e) =>
              dispatch({ type: "renameSection", sectionId: section.id, title: e.target.value })
            }
            placeholder="Room name"
            className="h-11 w-full rounded-control bg-transparent px-2 font-display text-title text-primary outline-none hover:bg-surface focus-visible:bg-surface focus-visible:outline-2 focus-visible:outline-teal-base"
          />
        </label>
        <MoneyText cents={roomTotal} className="hidden px-3 text-section font-semibold tablet:inline" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={index === 0}
          aria-label={`Move ${section.title} up`}
          onClick={() => dispatch({ type: "moveSection", from: index, to: index - 1 })}
        >
          <ArrowUp aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={index === count - 1}
          aria-label={`Move ${section.title} down`}
          onClick={() => dispatch({ type: "moveSection", from: index, to: index + 1 })}
        >
          <ArrowDown aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={count <= 1}
          aria-label={`Remove room ${section.title}`}
          onClick={() => dispatch({ type: "removeSection", sectionId: section.id })}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={section.lines.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          <ul className="divide-y divide-border" aria-label={`Lines in ${section.title}`}>
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
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {section.lines.length === 0 && (
        <p className="px-5 pt-5 text-secondary">
          No lines yet. Add from your catalogue or type a custom line.
        </p>
      )}
      <Button
        type="button"
        variant="secondary"
        className="m-3 w-[calc(100%-1.5rem)] tablet:w-auto"
        onClick={() => onAddLine(section.id)}
      >
        <Plus aria-hidden />
        Add line
      </Button>
    </section>
  );
}

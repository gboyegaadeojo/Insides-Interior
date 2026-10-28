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
import { TONE } from "~/components/ui/hue";
import { MoneyText } from "~/components/ui/text";
import type { DocumentTotals } from "~/domain/document";
import { cn } from "~/lib/utils";
import { HUES } from "~/styles/tokens";
import { LineEditor } from "./line-editor";
import type { DraftAction, DraftSection } from "./use-draft";

// Room sections as coloured cards (SPEC 6.8 builder), the room name in the
// display serif, a drag handle plus Move up/down (FR-QT-01).

const SECTION_HUES = HUES.filter((h) => h !== "teal");

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
  const hue = SECTION_HUES[index % SECTION_HUES.length]!;
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
        "@container rounded-sheet border-l-4 bg-surface-2 p-3 shadow-card",
        TONE[hue].border,
        isDragging && "relative z-20 shadow-sheet",
      )}
    >
      <div className="mb-3 flex items-center gap-1">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder room ${section.title}`}
          className="inline-flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-control text-secondary hover:bg-surface-3"
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
            className={cn(
              "h-11 w-full rounded-control bg-transparent px-2 font-display text-section outline-none hover:bg-surface focus-visible:bg-surface focus-visible:outline-2 focus-visible:outline-teal-base",
              TONE[hue].ink,
            )}
          />
        </label>
        <MoneyText cents={roomTotal} className="hidden px-2 font-semibold tablet:inline" />
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
          <ul className="flex flex-col gap-2" aria-label={`Lines in ${section.title}`}>
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
        <p className="px-2 pb-2 text-secondary">
          No lines yet. Add from your catalogue or type a custom line.
        </p>
      )}
      <Button
        type="button"
        variant="secondary"
        className="mt-3 w-full tablet:w-auto"
        onClick={() => onAddLine(section.id)}
      >
        <Plus aria-hidden />
        Add line
      </Button>
    </section>
  );
}

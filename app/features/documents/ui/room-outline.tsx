import { Plus } from "lucide-react";
import type { DocumentTotals } from "~/domain/document";
import { LOCALE } from "~/domain/locale";
import { cn } from "~/lib/utils";
import { roomAnchor, roomTotalCents } from "./section-card";
import type { DraftSection, SectionAction } from "./use-draft";

const WHOLE_NAIRA = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

/**
 * The rooms at a glance (premium redesign 2): one chip per room with its
 * subtotal, sticky above the editor, so a long quote is easy to follow. A tap
 * scrolls to the room; "+ Room" adds one.
 */
export function RoomOutline({
  sections,
  totals,
  dispatch,
}: {
  sections: DraftSection[];
  totals: DocumentTotals;
  dispatch: (action: SectionAction) => void;
}) {
  function jump(id: string) {
    const target = document.getElementById(roomAnchor(id));
    if (!target) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    target.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }

  return (
    <nav
      aria-label="Rooms"
      className="sticky top-16 z-10 -mx-1 flex [scrollbar-width:none] items-center gap-2 overflow-x-auto bg-canvas px-1 py-2"
    >
      <span className="mr-1 hidden shrink-0 text-label font-semibold text-secondary tablet:inline">
        Rooms
      </span>
      {sections.map((s) => {
        const empty = s.lines.length === 0;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => jump(s.id)}
            className={cn(
              "inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-surface px-3.5 text-label font-medium text-primary hover:bg-surface-2 pointer-fine:h-9",
            )}
          >
            <span className="max-w-40 truncate">{s.title || "Untitled room"}</span>
            <span className="font-normal text-secondary tabular">
              {empty ? "empty" : WHOLE_NAIRA.format(roomTotalCents(s, totals) / 100)}
            </span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={() =>
          dispatch({
            type: "addSection",
            section: { id: crypto.randomUUID(), title: `Room ${sections.length + 1}`, lines: [] },
          })
        }
        className="inline-flex h-11 shrink-0 items-center gap-1 rounded-full border border-dashed border-tertiary/60 px-3 text-label font-semibold text-accent hover:bg-accent-tint pointer-fine:h-9"
      >
        <Plus className="size-4" strokeWidth={2.4} aria-hidden />
        Room
      </button>
    </nav>
  );
}

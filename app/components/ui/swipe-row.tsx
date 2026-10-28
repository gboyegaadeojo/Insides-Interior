import * as Popover from "@radix-ui/react-popover";
import { type LucideIcon, MoreHorizontal } from "lucide-react";
import * as React from "react";
import { cn } from "~/lib/utils";
import { TONE, type ToneName } from "./hue";

export interface RowAction {
  label: string;
  icon: LucideIcon;
  tone: ToneName;
  onSelect: () => void;
}

const ACTION_WIDTH = 88;

/**
 * List row with swipe-left actions on touch, and the same actions in a visible
 * "…" menu for everyone else (DS-TCH-03). Long-press is never required.
 */
export function SwipeRow({
  actions,
  children,
  className,
}: {
  actions: RowAction[];
  children: React.ReactNode;
  className?: string;
}) {
  const max = actions.length * ACTION_WIDTH;
  const [offset, setOffset] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const drag = React.useRef<{ x: number; y: number; base: number; horizontal?: boolean } | null>(null);

  function onPointerDown(event: React.PointerEvent) {
    if (event.pointerType === "mouse") return;
    drag.current = { x: event.clientX, y: event.clientY, base: open ? -max : 0 };
  }
  function onPointerMove(event: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (d.horizontal === undefined && Math.abs(dx) + Math.abs(dy) > 8) {
      d.horizontal = Math.abs(dx) > Math.abs(dy);
      if (d.horizontal) setDragging(true);
    }
    if (!d.horizontal) return;
    setOffset(Math.min(0, Math.max(-max, d.base + dx)));
  }
  function onPointerUp() {
    setDragging(false);
    if (!drag.current?.horizontal) {
      drag.current = null;
      return;
    }
    drag.current = null;
    const shouldOpen = offset < -max / 2;
    setOpen(shouldOpen);
    setOffset(shouldOpen ? -max : 0);
  }
  function run(action: RowAction) {
    setOpen(false);
    setOffset(0);
    action.onSelect();
  }

  return (
    <div className={cn("relative overflow-hidden rounded-card border border-border bg-surface", className)}>
      <div className="absolute inset-y-0 right-0 flex" aria-hidden={!open}>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            tabIndex={open ? 0 : -1}
            onClick={() => run(action)}
            style={{ width: ACTION_WIDTH }}
            className={cn(
              "flex flex-col items-center justify-center gap-1 text-micro font-semibold",
              TONE[action.tone].solid,
            )}
          >
            <action.icon className="size-5" aria-hidden />
            {action.label}
          </button>
        ))}
      </div>
      <div
        className="relative flex touch-pan-y items-center gap-2 bg-surface pr-1 transition-transform duration-standard ease-out"
        style={{ transform: `translateX(${offset}px)`, transitionDuration: dragging ? "0ms" : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="min-w-0 flex-1">{children}</div>
        <Popover.Root>
          <Popover.Trigger
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-secondary hover:bg-surface-2 hover:text-primary"
            aria-label="More actions"
          >
            <MoreHorizontal className="size-5" aria-hidden />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={4}
              className="z-50 min-w-48 rounded-card border border-border bg-surface p-1.5 text-primary shadow-sheet"
            >
              <ul role="menu">
                {actions.map((action) => (
                  <li key={action.label} role="none">
                    <Popover.Close asChild>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => run(action)}
                        className="flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-left hover:bg-surface-2 focus-visible:bg-surface-2"
                      >
                        <action.icon className={cn("size-5", TONE[action.tone].text)} aria-hidden />
                        {action.label}
                      </button>
                    </Popover.Close>
                  </li>
                ))}
              </ul>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}

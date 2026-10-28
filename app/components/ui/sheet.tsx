import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as React from "react";
import { cn } from "~/lib/utils";
import { CloseButton, DialogOverlay } from "./dialog";

// Refactored from legacy/src/components/ui/drawer.tsx into the responsive Sheet
// (SPEC 2.5, DS-TCH-05): a bottom sheet with a grab handle on phone (swipe down
// or Close to dismiss), a right-side sheet from tablet up (min 70% wide on
// tablet portrait, DS-PLT tablet portrait).
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

const DISMISS_DISTANCE = 96;

export interface SheetContentProps extends React.ComponentProps<typeof DialogPrimitive.Content> {
  title: string;
  description?: string;
  /** Sticky footer, e.g. the primary action, kept above the home indicator. */
  footer?: React.ReactNode;
}

/**
 * Remembers what had focus when an overlay opened and restores it on close.
 * Radix does this for its own Trigger; sheets and palettes opened from state
 * (the + New button, Ctrl+K) need it too (DS-A11Y).
 */
export function useRestoreFocus() {
  const previous = React.useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus() {
      previous.current = document.activeElement as HTMLElement | null;
    },
    onCloseAutoFocus(event: Event) {
      if (previous.current?.isConnected) {
        event.preventDefault();
        previous.current.focus();
      }
    },
  };
}

export function SheetContent({
  className,
  children,
  title,
  description,
  footer,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: SheetContentProps) {
  const restore = useRestoreFocus();
  const [dragY, setDragY] = React.useState(0);
  const start = React.useRef<number | null>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);

  function onPointerDown(event: React.PointerEvent) {
    start.current = event.clientY;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: React.PointerEvent) {
    if (start.current !== null) setDragY(Math.max(0, event.clientY - start.current));
  }
  function onPointerUp() {
    if (dragY > DISMISS_DISTANCE) closeRef.current?.click();
    start.current = null;
    setDragY(0);
  }

  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        onOpenAutoFocus={(event) => {
          restore.onOpenAutoFocus();
          onOpenAutoFocus?.(event);
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (!event.defaultPrevented) restore.onCloseAutoFocus(event);
        }}
        style={dragY ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
        className={cn(
          "fixed z-50 flex flex-col bg-surface text-primary shadow-sheet ease-out",
          // phone: bottom sheet
          "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-sheet",
          "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom",
          // tablet and up: right sheet
          "tablet:inset-y-0 tablet:right-0 tablet:left-auto tablet:max-h-none tablet:w-[max(70vw,28rem)] tablet:max-w-[44rem] tablet:rounded-t-none tablet:rounded-l-sheet",
          "tablet:data-[state=closed]:slide-out-to-right tablet:data-[state=open]:slide-in-from-right",
          "wide:w-[36rem]",
          "duration-panel",
          className,
        )}
        {...props}
      >
        <div
          className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center tablet:hidden"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-hidden
        >
          <span className="h-1.5 w-10 rounded-full bg-surface-3" />
        </div>
        <header className="flex shrink-0 items-start gap-3 px-5 pt-1 tablet:px-6 tablet:pt-6">
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title className="font-display text-title">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-secondary">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close ref={closeRef} className="sr-only" tabIndex={-1} aria-hidden>
            Close
          </DialogPrimitive.Close>
          <CloseButton className="-mt-1 -mr-2" />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 tablet:px-6">
          {children}
        </div>
        {footer && (
          <footer className="shrink-0 border-t border-border px-5 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] tablet:px-6">
            {footer}
          </footer>
        )}
        {!footer && <div className="h-[env(safe-area-inset-bottom)] shrink-0" />}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, FileText, Minus, Plus, X } from "lucide-react";
import * as React from "react";
import { Button } from "./button";

// FR-EXP-03 receipt viewer: full screen, pinch or buttons to zoom, swipe or
// arrow keys between receipts, Escape, swipe down or Close to leave. Focus is
// trapped and restored by Radix; the position ("2 of 5") is announced.

export interface Receipt {
  url: string;
  /** e.g. "Balogun Market, 12 Oct 2026". */
  title: string;
  pdf?: boolean;
}

const SWIPE = 60;
const MAX_ZOOM = 4;

export function ReceiptViewer({
  receipts,
  index,
  onIndexChange,
  onClose,
}: {
  receipts: Receipt[];
  /** Open on this receipt; null = closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const open = index !== null && receipts.length > 0;
  const current = open ? receipts[Math.min(index, receipts.length - 1)]! : null;
  // Zoom and pan belong to one receipt; moving to another starts at 1×.
  const [view, setView] = React.useState({ for: index, zoom: 1, pan: { x: 0, y: 0 } });
  const fresh = view.for !== index;
  const zoom = fresh ? 1 : view.zoom;
  const pan = fresh ? { x: 0, y: 0 } : view.pan;
  const setZoom = (next: number | ((z: number) => number)) =>
    setView((v) => {
      const base = v.for === index ? v : { for: index, zoom: 1, pan: { x: 0, y: 0 } };
      const z = typeof next === "function" ? next(base.zoom) : next;
      return { ...base, zoom: z, pan: z === 1 ? { x: 0, y: 0 } : base.pan };
    });
  const setPan = (p: { x: number; y: number }) =>
    setView((v) => ({ ...(v.for === index ? v : { for: index, zoom: 1 }), pan: p }));
  const [drag, setDrag] = React.useState({ x: 0, y: 0 });
  const pointers = React.useRef(new Map<number, { x: number; y: number }>());
  const gesture = React.useRef<{
    startDist?: number;
    startZoom: number;
    start: { x: number; y: number };
  } | null>(null);

  const go = (step: number) => {
    if (index === null) return;
    const next = index + step;
    if (next >= 0 && next < receipts.length) onIndexChange(next);
  };

  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    gesture.current = {
      startZoom: zoom,
      start: { x: e.clientX - pan.x, y: e.clientY - pan.y },
      startDist: pts.length === 2 ? Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) : undefined,
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2 && gesture.current.startDist) {
      const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      setZoom(
        Math.min(MAX_ZOOM, Math.max(1, (gesture.current.startZoom * dist) / gesture.current.startDist)),
      );
      return;
    }
    if (zoom > 1) {
      setPan({ x: e.clientX - gesture.current.start.x, y: e.clientY - gesture.current.start.y });
    } else {
      setDrag({ x: e.clientX - gesture.current.start.x, y: e.clientY - gesture.current.start.y });
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) return;
    if (zoom === 1) {
      if (drag.y > SWIPE * 1.5 && Math.abs(drag.y) > Math.abs(drag.x)) onClose();
      else if (drag.x < -SWIPE) go(1);
      else if (drag.x > SWIPE) go(-1);
    }
    setDrag({ x: 0, y: 0 });
    gesture.current = null;
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-backdrop" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col bg-canvas text-primary outline-none"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") go(1);
            if (e.key === "ArrowLeft") go(-1);
            if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(MAX_ZOOM, z + 0.5));
            if (e.key === "-") setZoom((z) => Math.max(1, z - 0.5));
          }}
        >
          <header className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2">
            <div className="min-w-0 flex-1 px-2">
              <DialogPrimitive.Title className="truncate font-semibold">
                {current?.title ?? "Receipt"}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-label text-secondary" aria-live="polite">
                Receipt {index === null ? 0 : index + 1} of {receipts.length}
                <span className="sr-only">. Use the arrow keys to move between receipts.</span>
              </DialogPrimitive.Description>
            </div>
            {!current?.pdf && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Zoom out"
                  disabled={zoom <= 1}
                  onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
                >
                  <Minus aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Zoom in"
                  disabled={zoom >= MAX_ZOOM}
                  onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 0.5))}
                >
                  <Plus aria-hidden />
                </Button>
              </>
            )}
            <DialogPrimitive.Close asChild>
              <Button variant="secondary" size="icon" aria-label="Close receipt">
                <X aria-hidden />
              </Button>
            </DialogPrimitive.Close>
          </header>

          <div
            className="relative min-h-0 flex-1 touch-none overflow-hidden select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={() => {
              setZoom((z) => (z > 1 ? 1 : 2));
              setPan({ x: 0, y: 0 });
            }}
          >
            {current &&
              (current.pdf ? (
                <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
                  <FileText className="size-12 text-roseclay-base" aria-hidden />
                  <p>This receipt is a PDF.</p>
                  <Button asChild>
                    <a href={current.url} target="_blank" rel="noreferrer">
                      Open the PDF
                    </a>
                  </Button>
                </div>
              ) : (
                <img
                  src={current.url}
                  alt={`Receipt: ${current.title}`}
                  draggable={false}
                  className="absolute inset-0 m-auto max-h-full max-w-full object-contain motion-safe:transition-transform motion-safe:duration-fast"
                  style={{
                    transform: `translate(${pan.x + (zoom === 1 ? drag.x : 0)}px, ${pan.y + (zoom === 1 ? Math.max(0, drag.y) : 0)}px) scale(${zoom})`,
                    transition: drag.x || drag.y ? "none" : undefined,
                  }}
                />
              ))}
          </div>

          {receipts.length > 1 && (
            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-surface px-3 pt-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
              <Button variant="secondary" onClick={() => go(-1)} disabled={index === 0}>
                <ChevronLeft aria-hidden />
                Previous
              </Button>
              <span className="text-label text-secondary tabular" aria-hidden>
                {(index ?? 0) + 1} / {receipts.length}
              </span>
              <Button variant="secondary" onClick={() => go(1)} disabled={index === receipts.length - 1}>
                Next
                <ChevronRight aria-hidden />
              </Button>
            </footer>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

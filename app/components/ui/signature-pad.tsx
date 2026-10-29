import { Eraser } from "lucide-react";
import * as React from "react";
import { SIGNATURE_BOX } from "~/domain/portal";
import { cn } from "~/lib/utils";
import { Button } from "./button";

/**
 * Optional drawn signature (FR-QT-15) for approving in person on a tablet.
 * Captures strokes as integer points in SIGNATURE_BOX and submits them as JSON
 * in a hidden field; the server builds the SVG, so no markup comes from the
 * browser. Finger, Apple Pencil or mouse; the typed name stays the legal mark.
 */
export function SignaturePad({
  name,
  label = "Signature (optional)",
  className,
}: {
  name: string;
  label?: string;
  className?: string;
}) {
  const [strokes, setStrokes] = React.useState<number[][]>([]);
  const drawing = React.useRef<number[] | null>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const labelId = React.useId();

  function point(event: React.PointerEvent) {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = Math.round(((event.clientX - rect.left) / rect.width) * SIGNATURE_BOX.width);
    const y = Math.round(((event.clientY - rect.top) / rect.height) * SIGNATURE_BOX.height);
    return [Math.min(SIGNATURE_BOX.width, Math.max(0, x)), Math.min(SIGNATURE_BOX.height, Math.max(0, y))];
  }

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = point(event);
    setStrokes((s) => [...s, drawing.current!]);
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!drawing.current) return;
    const stroke = [...drawing.current, ...point(event)];
    drawing.current = stroke;
    setStrokes((s) => [...s.slice(0, -1), stroke]);
  }

  function onPointerUp() {
    drawing.current = null;
  }

  const path = strokes
    .map((s) => {
      const pairs: string[] = [];
      for (let i = 0; i < s.length; i += 2) pairs.push(`${s[i]} ${s[i + 1]}`);
      // A single tap draws a dot.
      return s.length === 2 ? `M${pairs[0]}l0.1 0` : `M${pairs.join("L")}`;
    })
    .join("");

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between">
        <span id={labelId} className="text-label font-semibold">
          {label}
        </span>
        <Button type="button" variant="ghost" onClick={() => setStrokes([])} disabled={strokes.length === 0}>
          <Eraser aria-hidden />
          Clear
        </Button>
      </div>
      <svg
        ref={svgRef}
        role="img"
        aria-labelledby={labelId}
        aria-description={strokes.length ? "Signature drawn" : "Draw your signature here"}
        viewBox={`0 0 ${SIGNATURE_BOX.width} ${SIGNATURE_BOX.height}`}
        className="aspect-[10/3] w-full touch-none rounded-control border border-tertiary bg-surface text-primary"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <line
          x1="40"
          x2={SIGNATURE_BOX.width - 40}
          y1={SIGNATURE_BOX.height - 60}
          y2={SIGNATURE_BOX.height - 60}
          className="stroke-border"
          strokeWidth="2"
        />
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <input type="hidden" name={name} value={strokes.length ? JSON.stringify(strokes) : ""} />
    </div>
  );
}

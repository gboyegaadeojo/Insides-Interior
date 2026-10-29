import * as React from "react";
import { cn } from "~/lib/utils";

export interface Segment<T extends string> {
  value: T;
  label: string;
  /** Optional count shown after the label (SPEC 6.8 status filters). */
  count?: number;
}

/**
 * Pill segmented control with radio semantics: arrow keys move the selection,
 * one tab stop (WAI-ARIA radio group).
 */
export function SegmentedControl<T extends string>({
  label,
  segments,
  value,
  onValueChange,
  className,
}: {
  /** Accessible name for the group. */
  label: string;
  segments: Segment<T>[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + segments.length) % segments.length;
    onValueChange(segments[next]!.value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex w-fit max-w-full gap-0.5 self-start overflow-x-auto rounded-[10px] bg-surface-3/80 p-0.5",
        className,
      )}
    >
      {segments.map((segment, index) => {
        const selected = segment.value === value;
        return (
          <button
            key={segment.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(segment.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[8px] px-3.5 text-label whitespace-nowrap transition-colors duration-standard pointer-fine:h-8 pointer-fine:px-3",
              selected
                ? "bg-surface font-semibold text-primary shadow-[0_1px_3px_rgb(0_0_0/12%)]"
                : "font-medium text-primary hover:bg-surface/50",
            )}
          >
            {segment.label}
            {segment.count !== undefined && (
              <span className={cn("text-label font-normal tabular", "text-secondary")}>{segment.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

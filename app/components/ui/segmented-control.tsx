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
        "inline-flex w-fit max-w-full gap-0.5 self-start overflow-x-auto rounded-full border border-border bg-surface-2 p-0.5",
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
              "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-4 font-semibold whitespace-nowrap transition-colors duration-standard pointer-fine:h-9 pointer-fine:px-3.5",
              selected ? "bg-surface text-primary shadow-card" : "text-secondary hover:text-primary",
            )}
          >
            {segment.label}
            {segment.count !== undefined && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-micro tabular",
                  selected ? "bg-surface-2 text-primary" : "bg-surface-3 text-primary",
                )}
              >
                {segment.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

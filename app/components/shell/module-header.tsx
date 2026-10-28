import type * as React from "react";
import { cn } from "~/lib/utils";

/**
 * Module header band (DS-NAV-04): a soft two-stop wash from the module tint to
 * the canvas (DS-COL-07) carrying a one-line summary and the primary action.
 * The page title itself lives in the top bar. Colour comes from the nearest
 * [data-module] (the AppShell sets it per route).
 */
export function ModuleHeader({
  eyebrow,
  summary,
  action,
  className,
}: {
  eyebrow: string;
  summary: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "-mx-[var(--gutter)] mb-6 flex min-h-24 flex-col justify-end gap-4 bg-gradient-to-b from-mod-tint to-canvas px-[var(--gutter)] pt-4 pb-4 tablet:min-h-32 tablet:flex-row tablet:items-end tablet:justify-between",
        className,
      )}
    >
      <div>
        <p className="text-label font-semibold text-mod-ink">{eyebrow}</p>
        <p className="mt-1 text-section font-semibold text-primary">{summary}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </section>
  );
}

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
        "-mx-[var(--gutter)] mb-5 flex flex-col gap-3 border-t border-mod-tint bg-gradient-to-b from-mod-tint to-canvas px-[var(--gutter)] pt-5 pb-3 tablet:flex-row tablet:items-center tablet:justify-between",
        className,
      )}
    >
      <div>
        {/* The top bar already shows the module name; keep it for screen readers. */}
        <p className="sr-only">{eyebrow}</p>
        <p className="text-body font-medium text-secondary">{summary}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </section>
  );
}

import type * as React from "react";
import { cn } from "~/lib/utils";

/**
 * Module header band (DS-NAV-04): a quiet strip under the top bar carrying a
 * one-line summary and the primary action, closed by a hairline. The page
 * title itself lives in the top bar.
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
        "mb-5 flex flex-col gap-3 border-b border-border pt-2 pb-4 tablet:flex-row tablet:items-center tablet:justify-between",
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

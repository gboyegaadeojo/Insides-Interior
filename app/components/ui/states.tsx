import { AlertTriangle, type LucideIcon, RotateCw } from "lucide-react";
import * as React from "react";
import { cn } from "~/lib/utils";
import { Button } from "./button";
import { TONE, type ToneName } from "./hue";

/** Illustrated empty state with one action (DS-COL-04/07, SPEC 6.11). */
export function EmptyState({
  icon: Icon,
  tone = "teal",
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  tone?: ToneName;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-card border border-border bg-gradient-to-b to-surface px-6 py-12 text-center",
        tone === "teal" && "from-teal-tint",
        tone === "plum" && "from-plum-tint",
        tone === "indigo" && "from-indigo-tint",
        tone === "terracotta" && "from-terracotta-tint",
        tone === "saffron" && "from-saffron-tint",
        tone === "sage" && "from-sage-tint",
        tone === "roseclay" && "from-roseclay-tint",
        tone === "ocean" && "from-ocean-tint",
        className,
      )}
    >
      <span className="relative mb-5 inline-flex" aria-hidden>
        <span className={cn("absolute -top-2 -left-3 size-8 rounded-full opacity-60", TONE[tone].base)} />
        <span className={cn("absolute -right-4 -bottom-1 size-5 rounded-full opacity-40", TONE[tone].base)} />
        <span
          className={cn(
            "relative inline-flex size-20 items-center justify-center rounded-sheet shadow-card [&_svg]:size-9",
            TONE[tone].solid,
          )}
        >
          <Icon />
        </span>
      </span>
      <h2 className="font-display text-title">{title}</h2>
      {description && <div className="mt-2 max-w-md text-secondary">{description}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Error with a message and Retry (SPEC 6.11 ErrorState). */
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retrying = false,
  className,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-3 rounded-card border border-danger-base bg-danger-tint p-5",
        className,
      )}
    >
      <div className="flex items-center gap-2 font-semibold text-danger-ink">
        <AlertTriangle className="size-5" aria-hidden />
        {title}
      </div>
      <p className="text-danger-ink">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} loading={retrying}>
          {!retrying && <RotateCw aria-hidden />}
          Retry
        </Button>
      )}
    </div>
  );
}

/** Skeleton block; shimmer in the module tint, static under reduced motion (DS-MOT-06). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block rounded-control bg-[linear-gradient(90deg,var(--surface-2)_25%,var(--mod-tint,var(--surface-3))_50%,var(--surface-2)_75%)] bg-[length:200%_100%] motion-safe:animate-[shimmer_1.6s_linear_infinite]",
        className,
      )}
    />
  );
}

/** Accessible loading wrapper: hides the skeletons from AT and announces "Loading". */
export function Loading({ label = "Loading", children }: { label?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

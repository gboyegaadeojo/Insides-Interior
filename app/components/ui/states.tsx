import { AlertTriangle, type LucideIcon, RotateCw } from "lucide-react";
import * as React from "react";
import { cn } from "~/lib/utils";
import { Button } from "./button";
import { TONE, type ToneName } from "./hue";

/**
 * Empty state with one action (SPEC 6.11). Premium redesign 2: calm, a grey
 * icon circle on white; `tone` stays for callers and tints only the icon.
 */
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
        "flex flex-col items-center rounded-card border border-border bg-surface px-6 py-12 text-center",
        className,
      )}
    >
      <span
        className={cn(
          "mb-4 inline-flex size-14 items-center justify-center rounded-full bg-surface-2 [&_svg]:size-6",
          TONE[tone].ink,
        )}
        aria-hidden
      >
        <Icon strokeWidth={1.7} />
      </span>
      <h2 className="text-section font-semibold">{title}</h2>
      {description && <div className="mt-1.5 max-w-md text-secondary">{description}</div>}
      {action && <div className="mt-5">{action}</div>}
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

import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { TONE, type ToneName } from "./hue";

/**
 * An icon on a small neutral chip; the module or category colour is kept on the
 * glyph only (restrained palette, docs/decisions.md). Filled chips are walnut.
 */
export function IconChip({
  icon: Icon,
  tone,
  filled = false,
  size = "md",
  className,
}: {
  icon: LucideIcon;
  tone: ToneName;
  /** Filled for the selected nav item; tinted otherwise. */
  filled?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center transition-colors duration-standard",
        filled
          ? "bg-action text-action-on"
          : cn("bg-surface-2 ring-1 ring-border ring-inset", TONE[tone].ink),
        size === "sm" && "size-7 rounded-lg [&_svg]:size-4",
        size === "md" && "size-9 rounded-control [&_svg]:size-5",
        size === "lg" && "size-12 rounded-card [&_svg]:size-6",
        className,
      )}
    >
      <Icon />
    </span>
  );
}

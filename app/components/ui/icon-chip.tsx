import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { TONE, type ToneName } from "./hue";

/** An icon on a small rounded chip in a module or category colour (DS-NAV-01). */
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
        filled ? TONE[tone].solid : TONE[tone].soft,
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

import { hueForName, initials } from "~/lib/avatar";
import { cn } from "~/lib/utils";
import { TONE } from "./hue";

/** Initials on one of the eight bases, chosen by hashing the name (DS-COL-06). */
export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const hue = hueForName(name);
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none",
        TONE[hue].solid,
        size === "sm" && "size-7 text-micro",
        size === "md" && "size-9 text-label",
        size === "lg" && "size-12 text-body",
        size === "xl" && "size-20 text-title",
        className,
      )}
    >
      <span aria-hidden>{initials(name)}</span>
    </span>
  );
}

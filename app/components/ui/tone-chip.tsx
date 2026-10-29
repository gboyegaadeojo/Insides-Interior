import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { TONE, type ToneName } from "./hue";

/** A small coloured label chip (category, billable…); the text carries the meaning (DS-COL-03). */
export function ToneChip({
  tone,
  label,
  icon: Icon,
  className,
}: {
  tone: ToneName;
  label: string;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full items-center gap-1 truncate rounded-full px-2 text-micro font-semibold",
        TONE[tone].soft,
        className,
      )}
    >
      {Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
      <span className="truncate">{label}</span>
    </span>
  );
}

import { Briefcase, type LucideIcon, Package, Receipt, Wallet } from "lucide-react";
import { cn } from "~/lib/utils";
import { TONE, type ToneName } from "./hue";

export const ITEM_TYPES = ["service", "product", "fee", "allowance"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

// SPEC 6.8 builder: service Teal, product Sage, fee Saffron, allowance Ocean.
const ITEM_TYPE: Record<ItemType, { label: string; tone: ToneName; icon: LucideIcon }> = {
  service: { label: "Service", tone: "teal", icon: Briefcase },
  product: { label: "Product", tone: "sage", icon: Package },
  fee: { label: "Fee", tone: "saffron", icon: Receipt },
  allowance: { label: "Allowance", tone: "ocean", icon: Wallet },
};

export function ItemTypeChip({ type, className }: { type: ItemType; className?: string }) {
  const { label, tone, icon: Icon } = ITEM_TYPE[type];
  return (
    <span
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full px-2 text-label leading-none font-semibold whitespace-nowrap",
        TONE[tone].soft,
        className,
      )}
    >
      <Icon className="size-3" strokeWidth={2.4} aria-hidden />
      {label}
    </span>
  );
}

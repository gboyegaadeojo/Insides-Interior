import { Banknote, FileText, type LucideIcon, Receipt, UserPlus, Wallet } from "lucide-react";
import { Link } from "react-router";
import { cn } from "~/lib/utils";
import { TONE, type ToneName } from "../ui/hue";
import { Sheet, SheetContent } from "../ui/sheet";

interface Tile {
  label: string;
  description: string;
  to: string;
  icon: LucideIcon;
  tone: ToneName;
}

// DS-NAV-02. Each tile opens its module; the create flows arrive with each module.
const TILES: Tile[] = [
  { label: "New quote", description: "Price a job by room", to: "/quotes", icon: FileText, tone: "plum" },
  { label: "New invoice", description: "Bill a client", to: "/invoices", icon: Receipt, tone: "indigo" },
  {
    label: "Record payment",
    description: "Log money received",
    to: "/payments",
    icon: Banknote,
    tone: "ocean",
  },
  { label: "Log expense", description: "Snap a receipt", to: "/expenses", icon: Wallet, tone: "roseclay" },
  {
    label: "New client",
    description: "Add a contact and site",
    to: "/clients",
    icon: UserPlus,
    tone: "terracotta",
  },
];

export function NewSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Create" description="What would you like to make?">
        <ul className="grid grid-cols-2 gap-3 tablet:grid-cols-2">
          {TILES.map((tile, index) => (
            <li key={tile.label} className={cn(index === TILES.length - 1 && "col-span-2 tablet:col-span-2")}>
              <Link
                to={tile.to}
                onClick={() => onOpenChange(false)}
                className={cn(
                  "flex min-h-32 flex-col justify-between gap-4 rounded-sheet p-4 transition-transform duration-fast ease-out active:scale-[0.98]",
                  TONE[tile.tone].soft,
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-12 items-center justify-center rounded-card shadow-card [&_svg]:size-6",
                    TONE[tile.tone].solid,
                  )}
                  aria-hidden
                >
                  <tile.icon />
                </span>
                <span>
                  <span className="block text-section font-semibold">{tile.label}</span>
                  <span className="block text-label font-normal">{tile.description}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}

import { Banknote, ChevronRight, FileText, type LucideIcon, Receipt, UserPlus, Wallet } from "lucide-react";
import { Link } from "react-router";
import { Sheet, SheetContent } from "../ui/sheet";

interface Action {
  label: string;
  description: string;
  to: string;
  icon: LucideIcon;
}

// DS-NAV-02, premium redesign 2: an inset-grouped list (like an iOS action
// sheet) instead of colourful tiles; each row opens its module.
const ACTIONS: Action[] = [
  { label: "New quote", description: "Price a job by room", to: "/quotes", icon: FileText },
  { label: "New invoice", description: "Bill a client", to: "/invoices", icon: Receipt },
  { label: "Record payment", description: "Log money received", to: "/payments", icon: Banknote },
  { label: "Log expense", description: "Snap a receipt", to: "/expenses", icon: Wallet },
  { label: "New client", description: "Add a contact and site", to: "/clients", icon: UserPlus },
];

export function NewSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Create" description="What would you like to make?">
        <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
          {ACTIONS.map((action) => (
            <li key={action.label}>
              <Link
                to={action.to}
                onClick={() => onOpenChange(false)}
                className="flex min-h-16 items-center gap-3.5 px-4 py-2.5 transition-colors duration-fast hover:bg-surface-2 active:bg-surface-3/60"
              >
                <span
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-surface-2 text-primary [&_svg]:size-[18px]"
                  aria-hidden
                >
                  <action.icon strokeWidth={1.8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{action.label}</span>
                  <span className="block text-label text-secondary">{action.description}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-tertiary" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}

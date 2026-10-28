import {
  Banknote,
  ChartColumnBig,
  FileText,
  FolderKanban,
  House,
  Inbox,
  Library,
  type LucideIcon,
  Receipt,
  Settings,
  Users,
  Wallet,
} from "lucide-react";
import { MODULES, type Module } from "~/styles/tokens";
import type { ToneName } from "../ui/hue";

export interface Destination {
  module: Module;
  label: string;
  to: string;
  icon: LucideIcon;
  tone: ToneName;
}

function destination(module: Module, label: string, to: string, icon: LucideIcon): Destination {
  return { module, label, to, icon, tone: MODULES[module] };
}

// SPEC 6.2: primary destinations, then More.
export const PRIMARY: Destination[] = [
  destination("home", "Home", "/", House),
  destination("quotes", "Quotes", "/quotes", FileText),
  destination("invoices", "Invoices", "/invoices", Receipt),
  destination("clients", "Clients", "/clients", Users),
  destination("inbox", "Inbox", "/inbox", Inbox),
];

export const MORE: Destination[] = [
  destination("projects", "Projects", "/projects", FolderKanban),
  destination("catalogue", "Catalogue", "/catalogue", Library),
  destination("expenses", "Expenses", "/expenses", Wallet),
  destination("payments", "Payments", "/payments", Banknote),
  destination("reports", "Reports", "/reports", ChartColumnBig),
  destination("settings", "Settings", "/settings", Settings),
];

export const ALL_DESTINATIONS = [...PRIMARY, ...MORE];

/** Phone "More" lists Clients and Inbox first (SPEC 6.2). */
export const PHONE_MORE: Destination[] = [PRIMARY[3]!, PRIMARY[4]!, ...MORE];

export function isActive(to: string, pathname: string) {
  return to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
}

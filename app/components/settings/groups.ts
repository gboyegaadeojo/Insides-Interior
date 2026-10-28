import {
  BellRing,
  Building2,
  Database,
  FileCog,
  type LucideIcon,
  Mail,
  Palette,
  Percent,
  ShieldCheck,
  SunMoon,
  Users,
} from "lucide-react";
import type { ToneName } from "~/components/ui/hue";

export interface SettingsGroup {
  path: string;
  label: string;
  description: string;
  icon: LucideIcon;
  tone: ToneName;
  ownerOnly: boolean;
}

// FR-SET-11 groups, plus Account (passkeys and sessions, FR-AUTH-02/05).
export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    path: "business",
    label: "Business",
    description: "Name, address, contact, logo",
    icon: Building2,
    tone: "teal",
    ownerOnly: true,
  },
  {
    path: "branding",
    label: "Branding",
    description: "Colour on documents and the portal",
    icon: Palette,
    tone: "plum",
    ownerOnly: true,
  },
  {
    path: "tax",
    label: "Tax and currency",
    description: "TIN, RC number and VAT",
    icon: Percent,
    tone: "saffron",
    ownerOnly: true,
  },
  {
    path: "documents",
    label: "Documents",
    description: "Numbering, defaults, how to pay",
    icon: FileCog,
    tone: "indigo",
    ownerOnly: true,
  },
  {
    path: "email",
    label: "Email",
    description: "Wording of client emails",
    icon: Mail,
    tone: "ocean",
    ownerOnly: true,
  },
  {
    path: "reminders",
    label: "Reminders",
    description: "When payment reminders go out",
    icon: BellRing,
    tone: "roseclay",
    ownerOnly: true,
  },
  {
    path: "team",
    label: "Team",
    description: "Invite and manage staff",
    icon: Users,
    tone: "terracotta",
    ownerOnly: true,
  },
  {
    path: "account",
    label: "Account",
    description: "Passkeys and signed-in devices",
    icon: ShieldCheck,
    tone: "sage",
    ownerOnly: false,
  },
  {
    path: "appearance",
    label: "Appearance",
    description: "Light, dark or system",
    icon: SunMoon,
    tone: "teal",
    ownerOnly: false,
  },
  {
    path: "data",
    label: "Data",
    description: "Backups and exports",
    icon: Database,
    tone: "ocean",
    ownerOnly: true,
  },
];

export function groupsFor(role: "owner" | "staff") {
  return SETTINGS_GROUPS.filter((g) => role === "owner" || !g.ownerOnly);
}

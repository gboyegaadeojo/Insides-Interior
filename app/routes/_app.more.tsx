import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { PHONE_MORE } from "~/components/shell/nav";
import { IconChip } from "~/components/ui/icon-chip";
import type { AppHandle } from "~/lib/route-handle";

export const handle: AppHandle = { module: "settings", title: "More" };

export function meta() {
  return [{ title: "More · Insides Interior" }];
}

/** Phone "More" tab (SPEC 6.2): Clients and Inbox first, then the rest. */
export default function More() {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-card">
      {PHONE_MORE.map((item) => (
        <li key={item.to}>
          <Link to={item.to} className="flex min-h-14 items-center gap-3 px-4 hover:bg-surface-2">
            <IconChip icon={item.icon} tone={item.tone} />
            <span className="flex-1 font-semibold">{item.label}</span>
            <ChevronRight className="size-5 text-secondary" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

import { Receipt } from "lucide-react";
import { ModulePlaceholder } from "~/components/shell/module-placeholder";
import type { AppHandle } from "~/lib/route-handle";

export const handle: AppHandle = { module: "invoices", title: "Invoices" };

export function meta() {
  return [{ title: "Invoices · Insides Interior" }];
}

export default function InvoicesScreen() {
  return (
    <ModulePlaceholder
      eyebrow="Invoices"
      summary="Nothing here yet"
      icon={Receipt}
      tone="indigo"
      title="No invoices yet"
      description="Deposit, progress and final invoices with one-tap payment recording arrive in an upcoming update."
    />
  );
}

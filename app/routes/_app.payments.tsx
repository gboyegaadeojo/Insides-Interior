import { Banknote } from "lucide-react";
import { ModulePlaceholder } from "~/components/shell/module-placeholder";
import type { AppHandle } from "~/lib/route-handle";

export const handle: AppHandle = { module: "payments", title: "Payments" };

export function meta() {
  return [{ title: "Payments · Insides Interior" }];
}

export default function PaymentsScreen() {
  return (
    <ModulePlaceholder
      eyebrow="Payments"
      summary="Nothing here yet"
      icon={Banknote}
      tone="ocean"
      title="No payments yet"
      description="Every payment you record will appear in this ledger."
    />
  );
}

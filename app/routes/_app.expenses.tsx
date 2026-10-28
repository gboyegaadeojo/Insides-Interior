import { Wallet } from "lucide-react";
import { ModulePlaceholder } from "~/components/shell/module-placeholder";
import type { AppHandle } from "~/lib/route-handle";

export const handle: AppHandle = { module: "expenses", title: "Expenses" };

export function meta() {
  return [{ title: "Expenses · Insides Interior" }];
}

export default function ExpensesScreen() {
  return (
    <ModulePlaceholder
      eyebrow="Expenses"
      summary="Nothing here yet"
      icon={Wallet}
      tone="roseclay"
      title="No expenses yet"
      description="Snap receipts and tag them to projects. Expenses arrive in an upcoming update."
    />
  );
}

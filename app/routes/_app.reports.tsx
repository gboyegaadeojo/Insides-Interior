import { ChartColumnBig } from "lucide-react";
import { ModulePlaceholder } from "~/components/shell/module-placeholder";
import type { AppHandle } from "~/lib/route-handle";

export const handle: AppHandle = { module: "reports", title: "Reports" };

export function meta() {
  return [{ title: "Reports · Insides Interior" }];
}

export default function ReportsScreen() {
  return (
    <ModulePlaceholder
      eyebrow="Reports"
      summary="Nothing here yet"
      icon={ChartColumnBig}
      tone="ocean"
      title="No reports yet"
      description="Sales tax, aged receivables and revenue reports arrive once you start invoicing."
    />
  );
}

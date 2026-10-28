import { FileText } from "lucide-react";
import { ModulePlaceholder } from "~/components/shell/module-placeholder";
import type { AppHandle } from "~/lib/route-handle";

export const handle: AppHandle = { module: "quotes", title: "Quotes" };

export function meta() {
  return [{ title: "Quotes · Insides Interior" }];
}

export default function QuotesScreen() {
  return (
    <ModulePlaceholder
      eyebrow="Quotes"
      summary="Nothing here yet"
      icon={FileText}
      tone="plum"
      title="No quotes yet"
      description="Price a job by room, mark optional items and send it for approval. Quotes arrive in an upcoming update."
    />
  );
}

import { Library } from "lucide-react";
import { ModulePlaceholder } from "~/components/shell/module-placeholder";
import type { AppHandle } from "~/lib/route-handle";

export const handle: AppHandle = { module: "catalogue", title: "Catalogue" };

export function meta() {
  return [{ title: "Catalogue · Insides Interior" }];
}

export default function CatalogueScreen() {
  return (
    <ModulePlaceholder
      eyebrow="Catalogue"
      summary="Nothing here yet"
      icon={Library}
      tone="sage"
      title="Your catalogue is empty"
      description="Reusable services, products, fees and room templates arrive in an upcoming update."
    />
  );
}

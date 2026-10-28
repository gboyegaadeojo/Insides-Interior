import { Users } from "lucide-react";
import { ModulePlaceholder } from "~/components/shell/module-placeholder";
import type { AppHandle } from "~/lib/route-handle";

export const handle: AppHandle = { module: "clients", title: "Clients" };

export function meta() {
  return [{ title: "Clients · Insides Interior" }];
}

export default function ClientsScreen() {
  return (
    <ModulePlaceholder
      eyebrow="Clients"
      summary="Nothing here yet"
      icon={Users}
      tone="terracotta"
      title="No clients yet"
      description="Your client directory with contacts, sites and balances arrives in an upcoming update."
    />
  );
}

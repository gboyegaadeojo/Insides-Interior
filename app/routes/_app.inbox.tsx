import { Inbox } from "lucide-react";
import { ModulePlaceholder } from "~/components/shell/module-placeholder";
import type { AppHandle } from "~/lib/route-handle";

export const handle: AppHandle = { module: "inbox", title: "Inbox" };

export function meta() {
  return [{ title: "Inbox · Insides Interior" }];
}

export default function InboxScreen() {
  return (
    <ModulePlaceholder
      eyebrow="Inbox"
      summary="Nothing here yet"
      icon={Inbox}
      tone="ocean"
      title="No conversations yet"
      description="Messages and change requests from clients will collect here."
    />
  );
}

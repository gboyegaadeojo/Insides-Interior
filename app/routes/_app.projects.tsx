import { FolderKanban } from "lucide-react";
import { ModulePlaceholder } from "~/components/shell/module-placeholder";
import type { AppHandle } from "~/lib/route-handle";

export const handle: AppHandle = { module: "projects", title: "Projects" };

export function meta() {
  return [{ title: "Projects · Insides Interior" }];
}

export default function ProjectsScreen() {
  return (
    <ModulePlaceholder
      eyebrow="Projects"
      summary="Nothing here yet"
      icon={FolderKanban}
      tone="saffron"
      title="No projects yet"
      description="Approved quotes become projects that track what is invoiced and paid."
    />
  );
}

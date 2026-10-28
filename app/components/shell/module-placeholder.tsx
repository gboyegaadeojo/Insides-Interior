import type { LucideIcon } from "lucide-react";
import type { ToneName } from "../ui/hue";
import { EmptyState } from "../ui/states";
import { ModuleHeader } from "./module-header";

/** A module screen whose feature has not been built yet: real header, honest empty state. */
export function ModulePlaceholder({
  eyebrow,
  summary,
  icon,
  tone,
  title,
  description,
}: {
  eyebrow: string;
  summary: string;
  icon: LucideIcon;
  tone: ToneName;
  title: string;
  description: string;
}) {
  return (
    <>
      <ModuleHeader eyebrow={eyebrow} summary={summary} />
      <EmptyState icon={icon} tone={tone} title={title} description={description} />
    </>
  );
}

import { DatabaseBackup, FileArchive, History } from "lucide-react";
import { SectionHeader } from "~/components/settings/section-header";
import { Card } from "~/components/ui/card";
import { IconChip } from "~/components/ui/icon-chip";
import { requireOwner } from "~/server/session";
import type { Route } from "./+types/data";

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireOwner(context.cloudflare.env, request);
  return null;
}

/** SPEC 11.3: what protects her records. Exports arrive with Reports (phase 9). */
export default function DataSettings() {
  const items = [
    {
      icon: History,
      tone: "teal" as const,
      title: "Point-in-time recovery",
      text: "The database can be restored to any minute within Cloudflare D1 Time Travel's retention window.",
    },
    {
      icon: DatabaseBackup,
      tone: "ocean" as const,
      title: "Nightly backups",
      text: "A full copy is saved every night to separate storage, kept 90 days, plus a monthly copy kept 7 years.",
    },
    {
      icon: FileArchive,
      tone: "saffron" as const,
      title: "Exports for your accountant",
      text: "CSV and PDF exports for any period are in Reports once you start invoicing.",
    },
  ];
  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Data"
        description="Sent quotes and invoices are never deleted; records are kept at least six years for CRA."
      />
      <Card>
        <ul className="flex flex-col gap-5">
          {items.map((item) => (
            <li key={item.title} className="flex gap-4">
              <IconChip icon={item.icon} tone={item.tone} />
              <div>
                <p className="font-semibold">{item.title}</p>
                <p className="text-secondary">{item.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

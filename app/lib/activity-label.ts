// Human wording for activity rows (timelines on client, project and document pages).

const LABELS: Record<string, string> = {
  "client.created": "Client added",
  "client.updated": "Details updated",
  "client.archived": "Client archived",
  "client.restored": "Client restored",
  "client.contact_added": "Contact added",
  "client.contact_updated": "Contact updated",
  "client.contact_removed": "Contact removed",
  "client.site_added": "Site added",
  "client.site_updated": "Site updated",
  "client.site_removed": "Site removed",
  "project.created": "Project created",
  "project.updated": "Project updated",
  "project.completed": "Project completed",
  "project.active": "Project reopened",
  "project.archived": "Project archived",
  "project.cover_updated": "Cover photo changed",
};

export function activityLabel(action: string, data?: Record<string, unknown> | null): string {
  const base = LABELS[action] ?? action.replaceAll(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const detail = (data?.contact ?? data?.site) as string | undefined;
  return detail ? `${base}: ${detail}` : base;
}

const RELATIVE = new Intl.RelativeTimeFormat("en-CA", { numeric: "auto" });
const DATE = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "America/Winnipeg",
});

/** "2 hours ago", "yesterday", or a date for anything older than a week. */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return "just now";
  if (abs < 3600) return RELATIVE.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return RELATIVE.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86400) return RELATIVE.format(Math.round(seconds / 86400), "day");
  return DATE.format(new Date(iso));
}

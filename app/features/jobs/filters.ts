// Quotes list filters by job step (owner request), shared by the list screen
// (browser) and the service (server). Kept apart from service.ts so the browser
// bundle never pulls in server code.

import type { JobGroup } from "~/domain/job";

export const JOB_FILTERS = ["needs", "waiting", "complete", "all"] as const;
export type JobFilter = (typeof JOB_FILTERS)[number];

export const JOB_FILTER_LABELS: Record<JobFilter, string> = {
  needs: "Needs you",
  waiting: "Waiting on client",
  complete: "Complete",
  all: "All",
};

export const JOB_FILTER_GROUPS: Record<Exclude<JobFilter, "all">, JobGroup[]> = {
  needs: ["now", "money", "finish"],
  waiting: ["waiting"],
  complete: ["complete"],
};

import { appendFileSync } from "node:fs";
import { test } from "@playwright/test";

/**
 * Saves a client link for the Lighthouse page-speed check (lighthouserc.cjs)
 * when CI sets PORTAL_LINKS_FILE; otherwise does nothing. Links carry share
 * tokens: the file is never uploaded and CI masks each link in its logs.
 */
export function recordPortalLink(kind: "quote" | "invoice", path: string) {
  const file = process.env.PORTAL_LINKS_FILE;
  if (!file) return;
  appendFileSync(file, `${JSON.stringify({ kind, path, project: test.info().project.name })}\n`);
}

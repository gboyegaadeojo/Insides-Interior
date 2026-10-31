/* global require, process, URL, module */
/* eslint-disable @typescript-eslint/no-require-imports -- Lighthouse CI loads its config with require() */
// Page-speed check for the client pages (SPEC 14 phase 5: Lighthouse CI on the
// portal). CI runs it against the PR's preview Worker, on the quote and invoice
// links the preview tests just made (PORTAL_LINKS_FILE, see
// tests/e2e/portal-links.ts). Mobile emulation with a slow 4G connection, as
// most clients open their link on a phone.
const { readFileSync } = require("node:fs");

const base = process.env.LHCI_BASE_URL;
const links = readFileSync(process.env.PORTAL_LINKS_FILE, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
// One quote and one invoice page.
const urls = ["quote", "invoice"].flatMap((kind) => {
  const link = links.find((l) => l.kind === kind);
  return link ? [new URL(link.path, base).toString()] : [];
});

module.exports = {
  ci: {
    collect: {
      url: urls,
      numberOfRuns: 3,
      settings: { chromeFlags: "--no-sandbox" },
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { minScore: 0.8, aggregationMethod: "median" }],
        "categories:accessibility": ["error", { minScore: 0.95, aggregationMethod: "median" }],
        "categories:best-practices": ["warn", { minScore: 0.9, aggregationMethod: "median" }],
        "largest-contentful-paint": ["error", { maxNumericValue: 4000, aggregationMethod: "median" }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1, aggregationMethod: "median" }],
        "total-blocking-time": ["warn", { maxNumericValue: 300, aggregationMethod: "median" }],
      },
    },
    // Reports stay on the runner (they contain the links); CI writes the scores to the run summary.
    upload: { target: "filesystem", outputDir: ".lighthouseci/reports" },
  },
};

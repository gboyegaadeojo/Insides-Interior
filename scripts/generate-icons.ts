// Renders the PWA icons (DS-PLT-04) from shapes with Playwright's Chromium.
// Run with `npm run icons` after changing the mark; the PNGs are committed.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const outDir = fileURLToPath(new URL("../public/icons/", import.meta.url));
mkdirSync(outDir, { recursive: true });

// Premium redesign 2: graphite tile, ivory mark, bronze accent.
const GRAPHITE = "#1D1D1F";
const IVORY = "#F5F5F7";
const BRONZE = "#C9A77C";

/** The mark on a 64-unit grid; `inset` shrinks it for maskable safe zones. */
function svg(size: number, { rounded, inset, badge }: { rounded: boolean; inset: number; badge?: boolean }) {
  const scale = 1 - inset * 2;
  const offset = 32 * (1 - scale);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
    ${badge ? "" : `<rect width="64" height="64" rx="${rounded ? 14 : 0}" fill="${GRAPHITE}"/>`}
    <g transform="translate(${offset} ${offset}) scale(${scale})">
      <path d="M21 15h22v6h-7.5v22H43v6H21v-6h7.5V21H21z" fill="${badge ? "#FFFFFF" : IVORY}"/>
      <circle cx="47" cy="17" r="4" fill="${badge ? "#FFFFFF" : BRONZE}"/>
    </g>
  </svg>`;
}

const ICONS = [
  { file: "icon-192.png", size: 192, rounded: true, inset: 0 },
  { file: "icon-512.png", size: 512, rounded: true, inset: 0 },
  // Maskable: full bleed, mark inside the central 80% safe zone.
  { file: "icon-maskable-512.png", size: 512, rounded: false, inset: 0.12 },
  // iOS rounds the corners itself.
  { file: "apple-touch-icon.png", size: 180, rounded: false, inset: 0.06 },
  // Android shows the alert badge as a white silhouette on transparent.
  { file: "badge-96.png", size: 96, rounded: false, inset: 0, badge: true },
];

const browser = await chromium.launch();
try {
  for (const icon of ICONS) {
    const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size } });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg(icon.size, icon)}</body></html>`,
    );
    await page.locator("svg").screenshot({ path: `${outDir}${icon.file}`, omitBackground: true });
    await page.close();
    console.log(`wrote public/icons/${icon.file}`);
  }
} finally {
  await browser.close();
}

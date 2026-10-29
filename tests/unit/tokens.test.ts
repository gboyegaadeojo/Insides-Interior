import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  contrast,
  HUES,
  type Hex,
  mix,
  renderTokensCss,
  resolveTheme,
  STATUS_EXTRA,
  type ThemeName,
} from "~/styles/tokens";

const AA_TEXT = 4.5;
const AA_UI = 3;

describe("tokens.css", () => {
  it("is up to date with app/styles/tokens.ts (run `npm run tokens`)", () => {
    const committed = readFileSync(new URL("../../app/styles/tokens.css", import.meta.url), "utf8");
    expect(committed.replaceAll("\r\n", "\n")).toBe(renderTokensCss());
  });
});

describe("colour maths", () => {
  it("matches known WCAG contrast values", () => {
    expect(contrast("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
  });

  it("mixes like color-mix(in srgb)", () => {
    expect(mix("#FFFFFF", "#000000", 0.5)).toBe("#808080");
    expect(mix("#0F766E", "#FFFFFF", 1)).toBe("#0F766E");
  });
});

// DS-COL-02: every text/background pair meets WCAG 2.2 AA in light and dark.
describe.each<ThemeName>(["light", "dark"])("%s theme contrast (DS-COL-02)", (name) => {
  const { neutrals, hues } = resolveTheme(name);
  const n = (key: string) => neutrals[key] as Hex;
  const backgrounds = ["canvas", "surface", "surface-2", "surface-3"];

  it.each(["text-primary", "text-secondary"])("%s is AA text on every neutral surface", (text) => {
    for (const bg of backgrounds) {
      expect(contrast(n(text), n(bg)), `${text} on ${bg}`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("primary action text is AA on the action fill, and the fill stands out from every surface", () => {
    expect(contrast(n("action-on"), n("action"))).toBeGreaterThanOrEqual(AA_TEXT);
    for (const bg of backgrounds) expect(contrast(n("action"), n(bg)), bg).toBeGreaterThanOrEqual(AA_UI);
  });

  // SPEC 6.3 says "verify contrast per use": tertiary text is only placed on
  // `surface` (cards, sheets); elsewhere it is an outline colour (docs/decisions.md).
  it("text-tertiary is AA text on surface and a 3:1 outline on every neutral", () => {
    expect(contrast(n("text-tertiary"), n("surface"))).toBeGreaterThanOrEqual(AA_TEXT);
    for (const bg of backgrounds) {
      expect(contrast(n("text-tertiary"), n(bg)), bg).toBeGreaterThanOrEqual(AA_UI);
    }
  });

  const allHues = [...HUES, ...(Object.keys(STATUS_EXTRA) as (keyof typeof STATUS_EXTRA)[])];

  it.each(allHues)("%s: ink on tint, on-colour on base, ink on surface are AA text", (hue) => {
    const t = hues[hue];
    expect(contrast(t.ink, t.tint), "ink on tint").toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(t.on, t.base), "on on base").toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(t.ink, n("surface")), "ink on surface").toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(t.ink, n("canvas")), "ink on canvas").toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(allHues)("%s: base is a 3:1 UI colour on surface and canvas (icons, rings, fills)", (hue) => {
    expect(contrast(hues[hue].base, n("surface"))).toBeGreaterThanOrEqual(AA_UI);
    expect(contrast(hues[hue].base, n("canvas"))).toBeGreaterThanOrEqual(AA_UI);
  });
});

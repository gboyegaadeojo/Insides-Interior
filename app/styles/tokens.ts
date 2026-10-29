// Design tokens (SPEC 6.3–6.6), the single source for app/styles/tokens.css.
// Edit here, then run `npm run tokens`. tests/unit/tokens.test.ts checks WCAG
// contrast for every pair and that tokens.css is up to date.

export type Hex = `#${string}`;

export const HUES = ["teal", "plum", "indigo", "terracotta", "saffron", "sage", "roseclay", "ocean"] as const;
export type Hue = (typeof HUES)[number];

/** SPEC 6.3 studio palette: tint, base, ink (light) and the dark-mode base. */
export const PALETTE: Record<Hue, { label: string; tint: Hex; base: Hex; ink: Hex; dark: Hex }> = {
  teal: { label: "Teal", tint: "#E6F4F2", base: "#0F766E", ink: "#0B4F4A", dark: "#4FD1C5" },
  plum: { label: "Plum", tint: "#F5EBF3", base: "#8E3B7E", ink: "#5E2453", dark: "#E09BD3" },
  indigo: { label: "Indigo", tint: "#ECEEFC", base: "#4453C4", ink: "#2C3690", dark: "#9AA6FF" },
  terracotta: { label: "Terracotta", tint: "#FBEEE8", base: "#C2532D", ink: "#8A3418", dark: "#F4A07F" },
  saffron: { label: "Saffron", tint: "#FCF4DD", base: "#B7800B", ink: "#7A5300", dark: "#F2C94C" },
  sage: { label: "Sage", tint: "#EDF4EC", base: "#4E7D51", ink: "#2F5332", dark: "#9BD19E" },
  roseclay: { label: "Rose clay", tint: "#FBEDEF", base: "#B4505F", ink: "#7D2E3A", dark: "#F2A3AE" },
  ocean: { label: "Ocean", tint: "#E8F2FA", base: "#2563A8", ink: "#183F6C", dark: "#8EC3F5" },
};

/** Status-only colours that are not studio hues (SPEC 6.3 status table). */
export const STATUS_EXTRA = {
  slate: { label: "Slate", light: "#64748B" as Hex, dark: "#94A3B8" as Hex },
  danger: { label: "Danger", light: "#B42332" as Hex, dark: "#FF7D87" as Hex },
};

/**
 * Warm ivory, white and linen surfaces with charcoal text (premium redesign,
 * docs/decisions.md). text-tertiary doubles as the 3:1 outline for controls.
 */
export const NEUTRALS: Record<string, { light: Hex; dark: Hex }> = {
  canvas: { light: "#F8F6F1", dark: "#121110" },
  surface: { light: "#FFFFFF", dark: "#1B1A18" },
  "surface-2": { light: "#F0EDE6", dark: "#252320" },
  "surface-3": { light: "#E6E1D8", dark: "#2F2C28" },
  border: { light: "#E2DDD4", dark: "#36322D" },
  "text-primary": { light: "#24211E", dark: "#F5F1EA" },
  "text-secondary": { light: "#68615A", dark: "#BDB5AA" },
  "text-tertiary": { light: "#7A7268", dark: "#9A9187" },
  /** Primary actions: deep walnut (ivory in dark mode). */
  action: { light: "#302B26", dark: "#F0EDE6" },
  "action-on": { light: "#FFFFFF", dark: "#24211E" },
};

/** SPEC 6.2 / 6.3: module → signature hue. */
export const MODULES = {
  home: "teal",
  quotes: "plum",
  invoices: "indigo",
  clients: "terracotta",
  projects: "saffron",
  catalogue: "sage",
  expenses: "roseclay",
  reports: "ocean",
  payments: "ocean",
  inbox: "ocean",
  settings: "teal",
} as const satisfies Record<string, Hue>;
export type Module = keyof typeof MODULES;

/** Text placed on a solid base fill: whichever of these passes contrast. */
export const ON_LIGHT: Hex = "#FFFFFF";
export const ON_DARK: Hex = "#1E1B18";

// In dark mode a tint is the dark base at this opacity over `surface` (SPEC 6.3: 14–18%).
const DARK_TINT_OPACITY = 0.16;
// Light-mode tints for the non-hue status colours.
const LIGHT_EXTRA_TINT_OPACITY = 0.1;

/**
 * Type scale: [phone, tablet+] sizes in px, line height, weight. Two steps
 * below SPEC 6.4 at the owner's request (docs/decisions.md); text inputs stay
 * 16px on touch screens so iOS Safari doesn't zoom on focus (app.css).
 */
export const TYPE_SCALE = {
  display: { phone: 24, tablet: 28, lineHeight: 1.15, weight: 500, font: "display" },
  title: { phone: 21, tablet: 24, lineHeight: 1.2, weight: 500, font: "display" },
  section: { phone: 16, tablet: 16, lineHeight: 1.35, weight: 600, font: "sans" },
  body: { phone: 15, tablet: 14, lineHeight: 1.5, weight: 400, font: "sans" },
  compact: { phone: 14, tablet: 14, desktop: 13, lineHeight: 1.45, weight: 400, font: "sans" },
  label: { phone: 12, tablet: 12, lineHeight: 1.4, weight: 600, font: "sans" },
  kpi: { phone: 24, tablet: 28, lineHeight: 1.1, weight: 650, font: "sans" },
  micro: { phone: 11, tablet: 11, lineHeight: 1.4, weight: 500, font: "sans" },
} as const;

/** SPEC 6.6 motion durations in ms: hover 150–200, press 120, panels ~200. */
export const MOTION = {
  press: 120,
  fast: 150,
  standard: 200,
  panel: 220,
  page: 220,
  chart: 400,
  celebrate: 900,
} as const;

export const RADII = { control: 10, card: 16, sheet: 20 } as const;

/** Breakpoints (SPEC 6.1): tablet portrait, tablet landscape, desktop. */
export const BREAKPOINTS = { tablet: 744, wide: 1024, desktop: 1280 } as const;

// ---------- colour maths ----------

function channels(hex: Hex): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): Hex {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0").toUpperCase()).join("")}`;
}

/** `amount` of `top` over `bottom`, mixed in sRGB like CSS color-mix(in srgb). */
export function mix(top: Hex, bottom: Hex, amount: number): Hex {
  const a = channels(top);
  const b = channels(bottom);
  return toHex([0, 1, 2].map((i) => a[i]! * amount + b[i]! * (1 - amount)) as [number, number, number]);
}

export function luminance(hex: Hex): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: Hex, b: Hex): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** White or near-black, whichever contrasts more with `fill`. */
export function onColour(fill: Hex): Hex {
  return contrast(ON_LIGHT, fill) >= contrast(ON_DARK, fill) ? ON_LIGHT : ON_DARK;
}

// ---------- resolved themes ----------

export type ThemeName = "light" | "dark";

export interface HueTokens {
  tint: Hex;
  base: Hex;
  ink: Hex;
  on: Hex;
}

export interface Theme {
  neutrals: Record<string, Hex>;
  hues: Record<Hue | keyof typeof STATUS_EXTRA, HueTokens>;
}

export function resolveTheme(name: ThemeName): Theme {
  const neutrals = Object.fromEntries(Object.entries(NEUTRALS).map(([k, v]) => [k, v[name]])) as Record<
    string,
    Hex
  >;
  const surface = neutrals.surface!;
  const hues = {} as Theme["hues"];
  for (const hue of HUES) {
    const p = PALETTE[hue];
    hues[hue] =
      name === "light"
        ? { tint: p.tint, base: p.base, ink: p.ink, on: onColour(p.base) }
        : { tint: mix(p.dark, surface, DARK_TINT_OPACITY), base: p.dark, ink: p.dark, on: onColour(p.dark) };
  }
  for (const [key, extra] of Object.entries(STATUS_EXTRA) as [
    keyof typeof STATUS_EXTRA,
    { light: Hex; dark: Hex },
  ][]) {
    const base = extra[name];
    hues[key] = {
      tint: mix(base, surface, name === "light" ? LIGHT_EXTRA_TINT_OPACITY : DARK_TINT_OPACITY),
      base,
      ink: name === "light" ? mix(base, "#000000", 0.85) : base,
      on: onColour(base),
    };
  }
  return { neutrals, hues };
}

// ---------- CSS output ----------

function colourBlock(theme: Theme, indent: string) {
  const vars: [string, string][] = Object.entries(theme.neutrals);
  for (const [hue, t] of Object.entries(theme.hues)) {
    vars.push([`${hue}-tint`, t.tint], [`${hue}-base`, t.base], [`${hue}-ink`, t.ink], [`${hue}-on`, t.on]);
  }
  return vars.map(([k, v]) => `${indent}--${k}: ${v};`).join("\n");
}

function darkExtras(indent: string) {
  return [
    "--elev-card: 0 1px 2px rgb(0 0 0 / 30%), 0 8px 24px rgb(0 0 0 / 24%);",
    "--elev-sheet: 0 24px 64px rgb(0 0 0 / 50%);",
    "--backdrop: rgb(0 0 0 / 60%);",
  ]
    .map((line) => indent + line)
    .join("\n");
}

const rem = (px: number) => `${px / 16}rem`;

export function renderTokensCss(): string {
  const light = resolveTheme("light");
  const dark = resolveTheme("dark");

  const typePhone: string[] = [];
  const typeTablet: string[] = [];
  const typeDesktop: string[] = [];
  for (const [name, t] of Object.entries(TYPE_SCALE)) {
    typePhone.push(
      `  --fs-${name}: ${rem(t.phone)};`,
      `  --lh-${name}: ${t.lineHeight};`,
      `  --fw-${name}: ${t.weight};`,
    );
    if (t.tablet !== t.phone) typeTablet.push(`    --fs-${name}: ${rem(t.tablet)};`);
    if ("desktop" in t) typeDesktop.push(`    --fs-${name}: ${rem(t.desktop)};`);
  }

  const modules = Object.entries(MODULES)
    .map(
      ([module, hue]) =>
        `[data-module="${module}"] {\n  --mod-tint: var(--${hue}-tint);\n  --mod-base: var(--${hue}-base);\n  --mod-ink: var(--${hue}-ink);\n  --mod-on: var(--${hue}-on);\n}`,
    )
    .join("\n");

  return `/* GENERATED by \`npm run tokens\` from app/styles/tokens.ts. Do not edit by hand. */

:root,
[data-theme="light"] {
  color-scheme: light;
${colourBlock(light, "  ")}
  --elev-card: 0 1px 2px rgb(36 33 30 / 4%), 0 6px 20px -8px rgb(36 33 30 / 8%);
  --elev-sheet: 0 24px 64px -12px rgb(36 33 30 / 22%);
  --backdrop: rgb(36 33 30 / 36%);
}

[data-theme="dark"] {
  color-scheme: dark;
${colourBlock(dark, "  ")}
${darkExtras("  ")}
}

@media (prefers-color-scheme: dark) {
  [data-theme="system"] {
    color-scheme: dark;
${colourBlock(dark, "    ")}
${darkExtras("    ")}
  }
}

:root {
${typePhone.join("\n")}
${Object.entries(MOTION)
  .map(([k, v]) => `  --duration-${k}: ${v}ms;`)
  .join("\n")}
  --easing-out: cubic-bezier(0.2, 0.8, 0.2, 1);
  --easing-in-out: cubic-bezier(0.4, 0, 0.2, 1);
${Object.entries(RADII)
  .map(([k, v]) => `  --rad-${k}: ${v}px;`)
  .join("\n")}
  --rail-expanded: 248px;
  --rail-collapsed: 80px;
  --tabbar-height: 64px;
  --gutter: 16px;
}

@media (min-width: ${BREAKPOINTS.tablet}px) {
  :root {
${typeTablet.join("\n")}
    --gutter: 24px;
  }
}

@media (min-width: ${BREAKPOINTS.desktop}px) {
  :root {
${typeDesktop.join("\n")}
    --gutter: 32px;
  }
}

@media (prefers-reduced-motion: reduce) {
  :root {
${Object.keys(MOTION)
  .map((k) => `    --duration-${k}: 0ms;`)
  .join("\n")}
  }
}

${modules}
`;
}

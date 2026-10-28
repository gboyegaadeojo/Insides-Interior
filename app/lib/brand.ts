import { contrast, type Hex, mix } from "~/styles/tokens";

const WHITE: Hex = "#FFFFFF";

export function isHex(value: string): value is Hex {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

export function normaliseHex(value: string): Hex | null {
  const v = value.trim();
  const short = /^#?([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(v);
  if (short)
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase() as Hex;
  const long = /^#?([0-9a-fA-F]{6})$/.exec(v);
  return long ? (`#${long[1]!.toUpperCase()}` as Hex) : null;
}

/**
 * FR-SET-09: the brand colour is used for headings, rules and white-text
 * buttons on white documents, so it must reach 4.5:1 against white. Returns the
 * colour itself when it passes, otherwise the nearest darker shade that does.
 */
export function accessibleBrandColor(hex: Hex): { ok: boolean; ratio: number; suggestion: Hex } {
  const ratio = contrast(hex, WHITE);
  if (ratio >= 4.5) return { ok: true, ratio, suggestion: hex };
  for (let step = 1; step <= 100; step++) {
    const candidate = mix("#000000", hex, step / 100);
    if (contrast(candidate, WHITE) >= 4.5) return { ok: false, ratio, suggestion: candidate };
  }
  return { ok: false, ratio, suggestion: "#000000" };
}

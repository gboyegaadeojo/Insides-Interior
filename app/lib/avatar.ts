import { HUES, type Hue } from "~/styles/tokens";

/** Stable hue for a name (DS-COL-06): FNV-1a over the normalised name. */
export function hueForName(name: string): Hue {
  let hash = 0x811c9dc5;
  for (const char of name.trim().toLowerCase()) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return HUES[hash % HUES.length]!;
}

/** "Mary-Jane O'Neil" → "MO"; "studio" → "ST"; "" → "?". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words.at(-1)![0]!).toUpperCase();
}

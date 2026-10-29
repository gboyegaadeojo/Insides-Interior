// Client portal rules (SPEC 5.6 FR-QT-03, FR-QT-10, FR-QT-11). Pure: the portal
// page, the approval service and the tests share them.

import type { ContentForTotals, ContentSection } from "./document";

/**
 * The content with the client's option choices applied. Only optional lines
 * change; ids that aren't optional lines are ignored, so a tampered form can't
 * switch off a regular line.
 */
export function applySelection<T extends ContentForTotals>(content: T, selectedIds: Iterable<string>): T {
  const chosen = new Set(selectedIds);
  return {
    ...content,
    sections: content.sections.map((section: ContentSection) => ({
      ...section,
      lines: section.lines.map((line) => (line.optional ? { ...line, selected: chosen.has(line.id) } : line)),
    })),
  };
}

/** Ids of the optional lines that are selected in the content as sent. */
export function selectedOptionIds(content: ContentForTotals): string[] {
  return content.sections.flatMap((s) => s.lines.filter((l) => l.optional && l.selected).map((l) => l.id));
}

/** Ids of every optional line. */
export function optionIds(content: ContentForTotals): string[] {
  return content.sections.flatMap((s) => s.lines.filter((l) => l.optional).map((l) => l.id));
}

/** FR-QT-11: a quote expires at the end of its valid-until business day. */
export function isPastValidUntil(validUntil: string | null | undefined, today: string): boolean {
  return !!validUntil && validUntil < today;
}

/** The drawing area for signatures (FR-QT-15): points are integers in this box. */
export const SIGNATURE_BOX = { width: 1000, height: 300 } as const;

/**
 * FR-QT-15: a drawn signature arrives as strokes of [x, y, x, y, …] points and
 * is stored as SVG built here, never as markup from the browser. Returns null
 * for anything malformed, empty or too large.
 */
export function signatureSvg(strokes: unknown): string | null {
  if (!Array.isArray(strokes) || strokes.length === 0 || strokes.length > 60) return null;
  const paths: string[] = [];
  let points = 0;
  for (const stroke of strokes) {
    if (!Array.isArray(stroke) || stroke.length < 2 || stroke.length % 2 !== 0) return null;
    points += stroke.length / 2;
    if (points > 4000) return null;
    const ok = stroke.every(
      (n, i) =>
        Number.isInteger(n) && n >= 0 && n <= (i % 2 === 0 ? SIGNATURE_BOX.width : SIGNATURE_BOX.height),
    );
    if (!ok) return null;
    const pairs: string[] = [];
    for (let i = 0; i < stroke.length; i += 2) pairs.push(`${stroke[i]} ${stroke[i + 1]}`);
    paths.push(`M${pairs.join("L")}`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIGNATURE_BOX.width} ${SIGNATURE_BOX.height}"><path d="${paths.join("")}" fill="none" stroke="#24211E" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** Typed full name for approval (FR-QT-10): two or more letters, trimmed, at most 120 characters. */
export function validateSignerName(name: string): string | null {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if ((trimmed.match(/\p{L}/gu) ?? []).length < 2) return "Type your full name";
  if (trimmed.length > 120) return "Use 120 characters or fewer";
  return null;
}

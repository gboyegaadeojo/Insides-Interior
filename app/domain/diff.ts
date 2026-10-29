// "What changed" between two revisions of a document (FR-MSG-06): lines added,
// removed or changed, and the total before and after. Lines are matched by id,
// which a revision keeps from the one it was copied from. Pure: the portal, the
// revised-document email and the app all show the same summary.

import { computeContent, type ContentForTotals, type ContentLine } from "./document";
import { formatCents, formatQuantity, lineAmountCents } from "./money";
import type { Discount } from "./tax";

export type ChangedField = "description" | "quantity" | "price" | "unit" | "discount" | "option" | "tax";

export interface LineChange {
  kind: "added" | "removed" | "changed";
  lineId: string;
  description: string;
  section: string;
  /** Changed lines only: what differs, in a fixed order. */
  fields: ChangedField[];
  before?: { qtyMilli: number; unit: string; unitPriceCents: number; amountCents: number };
  after?: { qtyMilli: number; unit: string; unitPriceCents: number; amountCents: number };
}

export interface DocumentDiff {
  lines: LineChange[];
  totalBeforeCents: number;
  totalAfterCents: number;
  /** Anything else that moves the total: the document discount. */
  discountChanged: boolean;
}

type Located = { line: ContentLine; section: string };

function index(content: ContentForTotals) {
  const map = new Map<string, Located>();
  for (const section of content.sections) {
    for (const line of section.lines) map.set(line.id, { line, section: section.title });
  }
  return map;
}

function sameDiscount(a: Discount | undefined, b: Discount | undefined) {
  if (!a || !b) return !a && !b;
  if (a.type !== b.type) return false;
  return a.type === "percent"
    ? a.bp === (b as { bp: number }).bp
    : a.cents === (b as { cents: number }).cents;
}

function figures(line: ContentLine) {
  return {
    qtyMilli: line.qtyMilli,
    unit: line.unit,
    unitPriceCents: line.unitPriceCents,
    amountCents: lineAmountCents(line.qtyMilli, line.unitPriceCents),
  };
}

function changedFields(a: ContentLine, b: ContentLine): ChangedField[] {
  const fields: ChangedField[] = [];
  if (a.description.trim() !== b.description.trim()) fields.push("description");
  if (a.qtyMilli !== b.qtyMilli) fields.push("quantity");
  if (a.unitPriceCents !== b.unitPriceCents) fields.push("price");
  if (a.unit !== b.unit) fields.push("unit");
  if (!sameDiscount(a.discount, b.discount)) fields.push("discount");
  if (Boolean(a.optional) !== Boolean(b.optional) || Boolean(a.selected) !== Boolean(b.selected))
    fields.push("option");
  if ([...a.taxRateIds].sort().join() !== [...b.taxRateIds].sort().join()) fields.push("tax");
  return fields;
}

/** Changes from `before` to `after`, in the order the lines appear (removed lines last). */
export function diffContent(
  before: ContentForTotals,
  after: ContentForTotals,
  deposit?: { before?: Discount; after?: Discount },
): DocumentDiff {
  const old = index(before);
  const now = index(after);
  const lines: LineChange[] = [];
  for (const [id, { line, section }] of now) {
    const prev = old.get(id);
    if (!prev) {
      lines.push({
        kind: "added",
        lineId: id,
        description: line.description,
        section,
        fields: [],
        after: figures(line),
      });
      continue;
    }
    const fields = changedFields(prev.line, line);
    if (fields.length > 0) {
      lines.push({
        kind: "changed",
        lineId: id,
        description: line.description,
        section,
        fields,
        before: figures(prev.line),
        after: figures(line),
      });
    }
  }
  for (const [id, { line, section }] of old) {
    if (!now.has(id)) {
      lines.push({
        kind: "removed",
        lineId: id,
        description: line.description,
        section,
        fields: [],
        before: figures(line),
      });
    }
  }
  return {
    lines,
    totalBeforeCents: computeContent(before, deposit?.before).computed.totalCents,
    totalAfterCents: computeContent(after, deposit?.after).computed.totalCents,
    discountChanged: !sameDiscount(before.documentDiscount, after.documentDiscount),
  };
}

export function hasChanges(diff: DocumentDiff): boolean {
  return diff.lines.length > 0 || diff.discountChanged || diff.totalBeforeCents !== diff.totalAfterCents;
}

/** One plain sentence per change, for the portal card and the email. */
export function describeChange(change: LineChange): string {
  const name = change.description.trim() || "Untitled line";
  if (change.kind === "added") return `Added ${name}`;
  if (change.kind === "removed") return `Removed ${name}`;
  const { before, after } = change;
  const parts: string[] = [];
  if (change.fields.includes("quantity") && before && after)
    parts.push(`quantity ${formatQuantity(before.qtyMilli)} → ${formatQuantity(after.qtyMilli)}`);
  if (change.fields.includes("price") && before && after)
    parts.push(`price ${formatCents(before.unitPriceCents)} → ${formatCents(after.unitPriceCents)}`);
  if (change.fields.includes("description")) parts.push("description");
  if (change.fields.includes("unit")) parts.push("unit");
  if (change.fields.includes("discount")) parts.push("discount");
  if (change.fields.includes("option")) parts.push("option choice");
  if (change.fields.includes("tax")) parts.push("tax");
  return `Changed ${name}: ${parts.join(", ")}`;
}

/** Sentences for the whole diff, capped for an email (`max` lines, then "and N more"). */
export function describeDiff(diff: DocumentDiff, max = Infinity): string[] {
  const sentences = diff.lines.map(describeChange);
  if (diff.discountChanged) sentences.push("Changed the overall discount");
  if (sentences.length <= max) return sentences;
  const rest = sentences.length - max;
  return [...sentences.slice(0, max), `and ${rest} more change${rest === 1 ? "" : "s"}`];
}

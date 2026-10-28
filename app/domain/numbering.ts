// Document numbering (SPEC 10.3, FR-SET-04). Allocation itself is one atomic
// UPDATE … RETURNING inside the send transaction (features/settings/service.ts
// and the send services); these are the pure rules around it.

export type SequenceKind = "quote" | "invoice";

export const DEFAULT_PREFIX: Record<SequenceKind, string> = { quote: "Q-", invoice: "INV-" };
export const DEFAULT_START = 1001;

/** "Q-" + 1042 → "Q-1042". */
export function formatDocumentNumber(prefix: string, value: number): string {
  return `${prefix}${value}`;
}

/** File name for a PDF (SPEC 10.4): Insides-Interior-INV-1042.pdf, -rev2 for revisions. */
export function pdfFileName(number: string, revision = 1): string {
  return `Insides-Interior-${number}${revision > 1 ? `-rev${revision}` : ""}.pdf`;
}

/** FR-SET-04: the next number can only increase. */
export function validateNextNumber(current: number, proposed: number): string | null {
  if (!Number.isSafeInteger(proposed) || proposed < 1) return "Enter a whole number of 1 or more";
  if (proposed < current) return `The next number can only go up (currently ${current})`;
  return null;
}

/** Prefix: letters, digits, dash, slash, dot; up to 12 characters. */
export function validatePrefix(prefix: string): string | null {
  if (prefix.length > 12) return "Use 12 characters or fewer";
  if (!/^[A-Za-z0-9\-/.]*$/.test(prefix)) return "Use letters, numbers, - / or . only";
  return null;
}

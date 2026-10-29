// Payer change requests (SPEC 5.14 FR-MSG-03/05). A request is tied to one line
// of one revision (or to the whole document) and never changes the document by
// itself: when the owner accepts one or more, `applyChangeRequests` makes the
// content of the single new draft revision. Pure and shared by the services
// and the screens.

export const CHANGE_KINDS = ["remove", "quantity", "question", "other"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** `line_ref` for a request about the document as a whole. */
export const WHOLE_DOCUMENT = "document";

export const CHANGE_KIND_LABEL: Record<ChangeKind, string> = {
  remove: "Remove this item",
  quantity: "Change quantity",
  question: "Ask a question",
  other: "Other",
};

export type ChangeStatus = "open" | "accepted" | "declined" | "answered";

export const CHANGE_STATUS_LABEL: Record<ChangeStatus, string> = {
  open: "Open",
  accepted: "Accepted",
  declined: "Declined",
  answered: "Answered",
};

interface LineLike {
  id: string;
  qtyMilli: number;
  /** Server-generated invoice lines (deposit portions, credits) can't be edited by a request. */
  locked?: boolean;
}

/** What a payer may ask of a line: generated lines and the whole document take words only. */
export function kindsFor(line: LineLike | null): ChangeKind[] {
  if (!line || line.locked) return ["question", "other"];
  return [...CHANGE_KINDS];
}

/** Questions are answered; everything else is accepted or declined. */
export function resolutionsFor(kind: ChangeKind): ("accept" | "decline" | "answer")[] {
  return kind === "question" ? ["answer"] : ["accept", "decline"];
}

export interface RequestToApply {
  id: string;
  lineRef: string;
  kind: ChangeKind;
  proposedQtyMilli: number | null;
}

export interface Applied<C> {
  content: C;
  /** Requests that changed a line. */
  applied: string[];
  /** Requests accepted without a content change (Other, or the line was already changed). */
  manual: string[];
}

/**
 * Applies accepted requests to a revision's content: Remove drops the line,
 * Change quantity sets it. Other is left to the owner to make by hand. A line
 * that is gone (or locked) is skipped rather than guessed at.
 */
export function applyChangeRequests<C extends { sections: { lines: L[] }[] }, L extends LineLike>(
  content: C,
  requests: RequestToApply[],
): Applied<C> {
  const remove = new Set<string>();
  const quantity = new Map<string, number>();
  const applied: string[] = [];
  const manual: string[] = [];
  const lines = new Map(content.sections.flatMap((s) => s.lines.map((l) => [l.id, l] as const)));
  for (const r of requests) {
    const line = lines.get(r.lineRef);
    const editable = line && !line.locked;
    if (r.kind === "remove" && editable) {
      remove.add(r.lineRef);
      applied.push(r.id);
    } else if (r.kind === "quantity" && editable && r.proposedQtyMilli !== null && r.proposedQtyMilli > 0) {
      quantity.set(r.lineRef, r.proposedQtyMilli);
      applied.push(r.id);
    } else {
      manual.push(r.id);
    }
  }
  return {
    content: {
      ...content,
      sections: content.sections.map((s) => ({
        ...s,
        lines: s.lines
          .filter((l) => !remove.has(l.id))
          .map((l) => (quantity.has(l.id) ? { ...l, qtyMilli: quantity.get(l.id)! } : l)),
      })),
    },
    applied,
    manual,
  };
}

import { z } from "zod";
import { CHANGE_KINDS } from "~/domain/change-requests";
import { parseQuantityToMilli } from "~/domain/money";

// The only writes a portal visitor can make (CLAUDE.md, SPEC 11): approve, post
// a message, raise a change request. Everything is bounded; totals never come
// from the browser.

const id = z.string().min(1).max(64);

/** FR-MSG-02: plain text, up to 2,000 characters (SPEC 11.1). */
export const MESSAGE_MAX = 2000;

export const approveSchema = z.object({
  intent: z.literal("approve"),
  /** The revision on screen: approving a stale revision fails (FR-QT-09). */
  revisionId: id,
  options: z.array(id).max(400),
  signerName: z.string().max(200),
  signerEmail: z
    .string()
    .trim()
    .max(254)
    .transform((v) => v || undefined)
    .pipe(z.email("Check your email address").optional()),
  agree: z.literal("on", { message: "Tick the box to agree to the quote and its terms" }),
  /** JSON strokes from the signature pad; turned into SVG on the server. */
  signature: z
    .string()
    .max(80_000)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

const name = z.string().trim().min(2, "Tell us your name").max(120);

/** A message in the document's conversation (FR-MSG-02). */
export const messageSchema = z.object({
  intent: z.literal("message"),
  revisionId: id,
  name,
  message: z.string().trim().min(1, "Write your message").max(MESSAGE_MAX, "Use 2,000 characters or fewer"),
});

/**
 * "Request a change" on a line, or on the whole document (FR-MSG-03). Change
 * quantity needs the new quantity; a question or Other needs words.
 */
const changeRequestFields = z.object({
  intent: z.literal("change_request"),
  revisionId: id,
  name,
  lineRef: id,
  kind: z.enum(CHANGE_KINDS, { message: "Choose what you'd like" }),
  quantity: z.string().trim().max(20).optional().default(""),
  note: z.string().trim().max(MESSAGE_MAX, "Use 2,000 characters or fewer").default(""),
});

export const changeRequestSchema = changeRequestFields.transform((v, ctx) => {
  let proposedQtyMilli: number | null = null;
  if (v.kind === "quantity") {
    proposedQtyMilli = parseQuantityToMilli(v.quantity);
    if (proposedQtyMilli === null || proposedQtyMilli <= 0) {
      ctx.addIssue({ code: "custom", path: ["quantity"], message: "Enter the quantity you'd like, e.g. 2" });
      return z.NEVER;
    }
  }
  if ((v.kind === "question" || v.kind === "other") && v.note.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["note"],
      message: v.kind === "question" ? "Write your question" : "Tell us what you'd like to change",
    });
    return z.NEVER;
  }
  const { quantity: _quantity, ...rest } = v;
  return { ...rest, proposedQtyMilli };
});

/** Every portal write; anything else is refused before it reaches a service. */
export const portalActionSchema = z.discriminatedUnion("intent", [
  approveSchema,
  messageSchema,
  changeRequestFields,
]);

export type ApproveInput = z.output<typeof approveSchema>;
export type MessageInput = z.output<typeof messageSchema>;
export type ChangeRequestInput = z.output<typeof changeRequestSchema>;

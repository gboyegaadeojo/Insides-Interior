import { z } from "zod";

// The only writes a portal visitor can make (CLAUDE.md, SPEC 11): approve, post
// a message, raise a change request. Everything is bounded; totals never come
// from the browser.

const id = z.string().min(1).max(64);

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

export const requestChangesSchema = z.object({
  intent: z.literal("request_changes"),
  revisionId: id,
  name: z.string().trim().min(2, "Tell us your name").max(120),
  message: z
    .string()
    .trim()
    .min(1, "Tell us what you'd like to change")
    .max(2000, "Use 2,000 characters or fewer"),
});

export const portalActionSchema = z.discriminatedUnion("intent", [approveSchema, requestChangesSchema]);

export type ApproveInput = z.output<typeof approveSchema>;
export type RequestChangesInput = z.output<typeof requestChangesSchema>;

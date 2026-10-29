import { z } from "zod";
import { isIsoDate } from "~/lib/dates";
import { sanitizeRichText } from "~/lib/rich-text";

// The draft the builder autosaves (FR-QT-01…06). Bounded so a single request
// can't store an enormous document; money and quantities are integers.

const id = z.string().min(1).max(64);
const cents = z.number().int().min(-10_000_000_000).max(10_000_000_000);

export const discountSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("percent"), bp: z.number().int().min(0).max(10_000) }),
  z.object({ type: z.literal("amount"), cents: z.number().int().min(0).max(10_000_000_000) }),
]);

export const lineSchema = z.object({
  id,
  itemId: id.optional(),
  itemType: z.enum(["service", "product", "fee", "allowance"]).optional(),
  description: z.string().max(300),
  details: z
    .string()
    .max(10_000)
    .optional()
    .transform((v) => (v ? sanitizeRichText(v) : undefined)),
  qtyMilli: z.number().int().min(0).max(1_000_000_000),
  unit: z.string().max(30),
  unitPriceCents: cents,
  taxRateIds: z.array(id).max(10),
  discount: discountSchema.optional(),
  optional: z.boolean().optional(),
  selected: z.boolean().optional(),
  /**
   * Marks a server-generated invoice line. Only a hint: the invoice service
   * swaps every locked line for its own stored copy, and quotes drop the flag.
   */
  locked: z.boolean().optional(),
});

export const sectionSchema = z.object({
  id,
  title: z.string().max(120),
  lines: z.array(lineSchema).max(200),
});

export const draftContentSchema = z
  .object({
    sections: z.array(sectionSchema).min(1, "Add at least one room").max(50),
    documentDiscount: discountSchema.optional(),
    notes: z.string().max(5000).optional(),
    terms: z.string().max(10_000).optional(),
  })
  .refine(
    (c) => c.sections.reduce((n, s) => n + s.lines.length, 0) <= 400,
    "A document can have up to 400 lines",
  );

export const draftHeaderSchema = z.object({
  title: z.string().trim().max(120).nullable(),
  clientId: id.nullable(),
  siteId: id.nullable(),
  validUntil: z
    .string()
    .nullable()
    .refine((v) => v === null || isIsoDate(v), "Choose a valid date"),
  depositType: z.enum(["percent", "amount"]).nullable(),
  depositValue: z.number().int().min(0).max(10_000_000_000).nullable(),
});

export const saveDraftSchema = z.object({
  /** The draft_version the editor last saw; a mismatch is a conflict (FR-QT-06). */
  version: z.number().int().min(0),
  header: draftHeaderSchema,
  content: draftContentSchema,
});

export type SaveDraftInput = z.output<typeof saveDraftSchema>;

/** "a@b.ng, c@d.ng" → ["a@b.ng", "c@d.ng"]; commas, semicolons or spaces. */
const emailList = z
  .string()
  .optional()
  .transform((v) => (v ?? "").split(/[\s,;]+/).filter(Boolean))
  .pipe(z.array(z.email("Check the email addresses")).max(5, "Up to 5 addresses"));

/** Send or re-send (FR-QT-08): recipients, an optional personal note. */
export const sendQuoteSchema = z.object({
  /** The draft_version on screen, so what's sent is what the owner saw. */
  version: z.coerce.number().int().min(0),
  to: z.email("Enter the client's email address").max(254),
  cc: emailList,
  bcc: emailList,
  note: z.string().trim().max(2000).optional(),
  /** A revision that deals with the open change requests closes them (FR-MSG-05). */
  resolveOpen: z
    .literal("on")
    .optional()
    .transform((v) => v === "on"),
});

/** `resolveOpen` is optional for callers other than the form (tests, retries). */
export type SendQuoteInput = Omit<z.output<typeof sendQuoteSchema>, "resolveOpen"> & {
  resolveOpen?: boolean;
};
export type DraftContentInput = z.output<typeof draftContentSchema>;
export type DraftLine = z.output<typeof lineSchema>;

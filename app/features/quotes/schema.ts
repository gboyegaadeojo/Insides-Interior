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
    "A quote can have up to 400 lines",
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
export type DraftContentInput = z.output<typeof draftContentSchema>;
export type DraftLine = z.output<typeof lineSchema>;

import { z } from "zod";
import { draftContentSchema } from "~/features/quotes/schema";
import { isIsoDate } from "~/lib/dates";
import { PAYMENT_METHODS } from "./constants";

// Invoices and payments (SPEC 5.7, 5.8). Bounded inputs; money in integer
// kobo, rates in basis points.

const id = z.string().min(1).max(64);
const isoDate = (message = "Choose a valid date") => z.string().refine(isIsoDate, message);

export const invoiceHeaderSchema = z.object({
  title: z.string().trim().max(120).nullable(),
  clientId: id.nullable(),
  siteId: id.nullable(),
  poReference: z
    .string()
    .trim()
    .max(60)
    .nullable()
    .transform((v) => v || null),
  termsDays: z.number().int().min(0).max(365).nullable(),
  dueDate: isoDate().nullable(),
});

export const saveInvoiceDraftSchema = z.object({
  version: z.number().int().min(0),
  header: invoiceHeaderSchema,
  content: draftContentSchema,
});

export type SaveInvoiceDraftInput = z.output<typeof saveInvoiceDraftSchema>;

/** Making an invoice from an approved quote (FR-INV-01, FR-QT-12/13). */
export const fromQuoteSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("deposit") }),
  z.object({ kind: z.literal("final") }),
  z.object({ kind: z.literal("full") }),
  z.object({
    kind: z.literal("progress"),
    portionType: z.enum(["percent", "amount"]),
    /** Basis points for a percent, kobo for an amount. */
    portionValue: z.coerce.number().int().min(1, "Enter how much to bill").max(10_000_000_000),
  }),
]);

export type FromQuoteInput = z.output<typeof fromQuoteSchema>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);

/** FR-PAY-01, 02, 06. Cash received plus optional withholding tax. */
export const recordPaymentSchema = z.object({
  amountCents: z.coerce.number().int().min(0, "Enter the amount received").max(10_000_000_000),
  receivedOn: isoDate("Choose the date it was received"),
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText(80),
  note: optionalText(500),
  whtRateBp: z.coerce.number().int().min(0).max(10_000).optional(),
  whtCents: z.coerce.number().int().min(0).max(10_000_000_000).default(0),
  whtReference: optionalText(80),
  /** The owner confirmed an overpayment becomes client credit. */
  allowCredit: z
    .string()
    .optional()
    .transform((v) => v === "on" || v === "true"),
});

export type RecordPaymentInput = z.output<typeof recordPaymentSchema>;

export const deletePaymentSchema = z.object({
  paymentId: id,
  reason: z.string().trim().min(3, "Say why it's being deleted").max(300),
});

export const voidInvoiceSchema = z.object({
  reason: z.string().trim().min(3, "Give a reason; it's kept with the invoice").max(500),
  reissue: z
    .string()
    .optional()
    .transform((v) => v === "on" || v === "true"),
});

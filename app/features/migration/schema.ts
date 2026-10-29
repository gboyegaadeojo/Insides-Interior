import { z } from "zod";
import { isIsoDate } from "~/lib/dates";
import { EXPENSE_CATEGORIES } from "../expenses/constants";
import { PAYMENT_METHODS } from "../invoices/constants";

// The import plan (SPEC 12): what scripts/migrate/transform.ts makes from the
// old app's exports. Validated again here, so nothing reaches the database
// unchecked even though it comes from our own script.

const date = z.string().refine(isIsoDate, "a YYYY-MM-DD date");
const text = (max: number) => z.string().trim().max(max).nullable();
const kobo = z.number().int().min(-10_000_000_000_00).max(10_000_000_000_00);
const legacyId = z.string().min(1).max(200);

export const planLineSchema = z.object({
  description: z.string().trim().min(1).max(500),
  qtyMilli: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  unitPriceCents: kobo,
  /** The old line's single tax rate, basis points; 750 maps to VAT. */
  taxBp: z.number().int().min(0).max(10_000),
  itemType: z.enum(["service", "product", "fee"]),
});

const docBase = {
  legacyId,
  number: text(60),
  clientLegacyId: legacyId.nullable(),
  clientName: text(200),
  issueDate: date.nullable(),
  lines: z.array(planLineSchema).max(500),
  notes: text(5000),
  terms: text(5000),
  legacyTotalCents: kobo.nullable(),
};

export const planSchema = z.object({
  clients: z.array(
    z.object({
      legacyId,
      displayName: z.string().trim().min(1).max(120),
      email: text(200),
      phone: text(40),
      address: text(500),
      notes: text(5000),
    }),
  ),
  items: z.array(
    z.object({
      legacyId,
      type: z.enum(["service", "product"]),
      name: z.string().trim().min(1).max(120),
      description: text(2000),
      priceCents: kobo.min(0),
      taxable: z.boolean(),
    }),
  ),
  quotes: z.array(
    z.object({
      ...docBase,
      status: z.enum(["draft", "sent", "changes_requested", "approved", "declined"]),
      converted: z.boolean(),
      validUntil: date.nullable(),
      clientComment: text(2000),
    }),
  ),
  invoices: z.array(
    z.object({
      ...docBase,
      status: z.enum(["draft", "sent", "partially_paid", "paid", "void"]),
      dueDate: date.nullable(),
      legacyBalanceCents: kobo.nullable(),
      fromQuoteNumber: text(60),
    }),
  ),
  payments: z.array(
    z.object({
      legacyId,
      invoiceLegacyId: legacyId,
      amountCents: kobo.min(1),
      receivedOn: date,
      method: z.enum(PAYMENT_METHODS),
      note: text(500),
    }),
  ),
  expenses: z.array(
    z.object({
      legacyId,
      date,
      supplier: z.string().trim().min(1).max(120),
      category: z.enum(EXPENSE_CATEGORIES),
      amountCents: kobo.min(1),
      note: text(500),
      receiptUrl: text(2000),
    }),
  ),
  warnings: z.array(z.string()),
});

export type Plan = z.output<typeof planSchema>;
export type PlanLine = z.output<typeof planLineSchema>;
export type PlanQuote = Plan["quotes"][number];
export type PlanInvoice = Plan["invoices"][number];

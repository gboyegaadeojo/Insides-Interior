import { z } from "zod";
import { parseMoneyToCents } from "~/domain/money";
import { isIsoDate } from "~/lib/dates";
import { percentToBp } from "../settings/schema";
import { EXPENSE_CATEGORIES } from "./constants";

// Expenses (SPEC 5.10). Money arrives as typed text ("12,500.00") and becomes
// integer kobo here.

const money = (label: string, required: boolean) =>
  z
    .string()
    .default("")
    .transform((raw, ctx) => {
      const v = raw.trim();
      if (v === "") {
        if (required) ctx.addIssue({ code: "custom", message: `Enter the ${label.toLowerCase()}` });
        return 0;
      }
      const cents = parseMoneyToCents(v);
      if (cents === null || cents < 0 || cents > 10_000_000_000) {
        ctx.addIssue({ code: "custom", message: `${label} must be an amount like 12,500.00` });
        return z.NEVER;
      }
      return cents;
    });

/** FR-EXP-01. `receiptKey` comes from the upload route, never from a typed value. */
export const expenseSchema = z
  .object({
    date: z.string().refine(isIsoDate, "Choose the date you paid"),
    supplier: z.string().trim().min(1, "Who did you pay?").max(120),
    category: z.enum(EXPENSE_CATEGORIES, { message: "Choose a category" }),
    amountCents: money("Amount", true),
    vatCents: money("VAT", false),
    projectId: z
      .string()
      .max(64)
      .optional()
      .transform((v) => v || null),
    billable: z
      .string()
      .optional()
      .transform((v) => v === "on" || v === "true"),
    note: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((v) => v || null),
    receiptKey: z
      .string()
      .max(200)
      .optional()
      .transform((v) => v || null),
  })
  .superRefine((v, ctx) => {
    if (v.amountCents <= 0)
      ctx.addIssue({ code: "custom", path: ["amountCents"], message: "Enter the amount paid" });
    if (v.vatCents > v.amountCents)
      ctx.addIssue({ code: "custom", path: ["vatCents"], message: "VAT can't be more than the amount paid" });
    if (v.billable && !v.projectId)
      ctx.addIssue({ code: "custom", path: ["projectId"], message: "Choose the project to bill it to" });
  });

export type ExpenseInput = z.output<typeof expenseSchema>;

/** FR-EXP-02: add billable expenses to the project's next invoice. */
export const billExpensesSchema = z.object({
  expenseIds: z.array(z.string().min(1).max(64)).min(1, "Choose at least one expense").max(50),
  markupBp: percentToBp("Markup", 1000),
});

export type BillExpensesInput = z.output<typeof billExpensesSchema>;

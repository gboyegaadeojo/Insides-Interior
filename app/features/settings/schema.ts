import { z } from "zod";
import { parseMoneyToCents } from "~/domain/money";
import { validatePrefix } from "~/domain/numbering";
import { normaliseHex } from "~/lib/brand";

// Shared by forms, actions and the service (SPEC 7.1: one schema validates the
// form, the action and the insert).

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer`)
    .transform((v) => (v === "" ? null : v));

const optionalEmail = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email address");

const wholeNumber = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, `${label} must be a whole number`)
    .transform(Number)
    .refine((n) => n >= min && n <= max, `${label} must be between ${min} and ${max}`);

/** "5" or "7.5" (percent) → basis points. */
export const percentToBp = (label: string, max = 100) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      const bp = parseMoneyToCents(v.replace(/%$/, ""));
      if (bp === null || bp < 0 || bp > max * 100) {
        ctx.addIssue({ code: "custom", message: `${label} must be a percentage from 0 to ${max}` });
        return z.NEVER;
      }
      return bp;
    });

export const businessProfileSchema = z.object({
  legalName: z.string().trim().min(1, "Enter the legal business name").max(120),
  tradingName: optionalText(120),
  line1: optionalText(120),
  line2: optionalText(120),
  city: optionalText(60),
  province: optionalText(40),
  postalCode: optionalText(12),
  phone: optionalText(30),
  email: optionalEmail,
  website: optionalText(120),
});

export const taxRegistrationSchema = z.object({
  gstNumber: optionalText(30),
  pstNumber: optionalText(30),
});

export const taxRateSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Name the tax, e.g. GST").max(40),
  rateBp: percentToBp("Rate", 30),
  appliesTo: z.enum(["services", "products", "both"]),
  isDefault: z
    .string()
    .optional()
    .transform((v) => v === "on" || v === "1"),
});

export const numberingSchema = z.object({
  quotePrefix: z
    .string()
    .trim()
    .refine((v) => validatePrefix(v) === null, { message: "Use up to 12 letters, numbers, - / or ." }),
  quoteNext: wholeNumber("Next quote number", 1, 99_999_999),
  invoicePrefix: z
    .string()
    .trim()
    .refine((v) => validatePrefix(v) === null, { message: "Use up to 12 letters, numbers, - / or ." }),
  invoiceNext: wholeNumber("Next invoice number", 1, 99_999_999),
});

export const documentDefaultsSchema = z.object({
  paymentTermsDays: wholeNumber("Payment terms", 0, 365),
  quoteValidDays: wholeNumber("Quote validity", 1, 365),
  defaultDepositBp: percentToBp("Deposit"),
  defaultNotes: optionalText(2000),
  defaultTerms: optionalText(5000),
});

export const paymentInstructionsSchema = z.object({
  etransferEmail: optionalEmail,
  etransferAutoDeposit: z
    .string()
    .optional()
    .transform((v) => v === "on"),
  etransferNote: optionalText(300),
  chequePayee: optionalText(120),
  mailingLine1: optionalText(120),
  mailingCity: optionalText(60),
  mailingProvince: optionalText(40),
  mailingPostalCode: optionalText(12),
});

export const brandColorSchema = z.object({
  brandColor: z.string().transform((v, ctx) => {
    const hex = normaliseHex(v);
    if (!hex) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a 6-digit hex colour, # then six characters 0–9 or A–F",
      });
      return z.NEVER;
    }
    return hex;
  }),
});

export const emailTemplateSchema = z.object({
  template: z.string().min(1),
  subject: z.string().trim().min(1, "Enter a subject").max(200),
  body: z.string().trim().min(1, "Enter the message").max(5000),
});

export const reminderCadenceSchema = z.object({
  offsets: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const parts = v.split(/[,\s]+/).filter(Boolean);
      const numbers = parts.map(Number);
      if (parts.length === 0 || numbers.some((n) => !Number.isInteger(n) || n < -60 || n > 120)) {
        ctx.addIssue({
          code: "custom",
          message: "List days like -3, 0, 7, 14 (negative = before the due date)",
        });
        return z.NEVER;
      }
      return [...new Set(numbers)].sort((a, b) => a - b);
    }),
  maxCount: wholeNumber("Maximum reminders", 0, 12),
  quietStartHour: wholeNumber("Quiet hours start", 0, 23),
  quietEndHour: wholeNumber("Quiet hours end", 0, 23),
  quoteFollowUpDays: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const numbers = v
        .split(/[,\s]+/)
        .filter(Boolean)
        .map(Number);
      if (numbers.some((n) => !Number.isInteger(n) || n < 1 || n > 90)) {
        ctx.addIssue({ code: "custom", message: "List days after sending, like 3, 7" });
        return z.NEVER;
      }
      return [...new Set(numbers)].sort((a, b) => a - b);
    }),
});

export const inviteSchema = z.object({
  name: z.string().trim().min(1, "Enter their name").max(80),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
});

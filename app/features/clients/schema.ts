import { z } from "zod";

// Optional fields may be left out of a form entirely (e.g. a short "add site" form).
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer`)
    .optional()
    .transform((v) => (v ? v : null));

const email = z
  .string()
  .trim()
  .toLowerCase()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email address");

const phone = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^[+\d\s().-]{7,25}$/.test(v), "Enter a phone number like 0803 123 4567");

const name = z.string().trim().min(1, "Enter a name").max(120, "Use 120 characters or fewer");

export const addressFields = {
  line1: text(120),
  line2: text(120),
  city: text(60),
  state: text(40),
  postalCode: text(12),
};

/** FR-CLI-01: create inline with three fields. */
export const quickClientSchema = z.object({ displayName: name, email, phone });

/** FR-CLI-02: the full client record. */
export const clientSchema = z.object({
  displayName: name,
  company: text(120),
  email,
  phone,
  ...addressFields,
  notes: text(5000),
  tags: z
    .string()
    .trim()
    .optional()
    .transform((v) =>
      [
        ...new Set(
          (v ?? "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      ]
        .slice(0, 20)
        .map((t) => t.slice(0, 30)),
    ),
});

export const contactSchema = z.object({
  id: z.string().optional(),
  name,
  email,
  phone,
  role: text(60),
  isPrimary: z
    .string()
    .optional()
    .transform((v) => v === "on"),
});

export const siteSchema = z.object({
  id: z.string().optional(),
  label: z.string().trim().min(1, "Name this site, e.g. Home or Cottage").max(60),
  ...addressFields,
});

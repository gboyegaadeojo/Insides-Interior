// Business settings (SPEC 5.2). The only code that writes settings, tax rates,
// numbering and the logo. Every write goes in one D1 batch with its activity.

import { and, asc, eq, isNull, lte } from "drizzle-orm";
import type { z } from "zod";
import { validateNextNumber } from "~/domain/numbering";
import { accessibleBrandColor } from "~/lib/brand";
import { newId } from "~/lib/ids";
import { EMAIL_TEMPLATE_DEFAULTS } from "~/lib/merge-fields";
import { activityInsert } from "~/server/audit";
import { schema } from "~/server/db";
import type { RequestContext } from "~/server/session";
import type {
  brandColorSchema,
  businessProfileSchema,
  documentDefaultsSchema,
  emailTemplateSchema,
  numberingSchema,
  paymentInstructionsSchema,
  reminderCadenceSchema,
  taxRateSchema,
  taxRegistrationSchema,
} from "./schema";

export class ServiceError extends Error {
  constructor(
    message: string,
    readonly field = "form",
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

const nowIso = () => new Date().toISOString();

export async function loadSettings({ db, user }: Pick<RequestContext, "db" | "user">) {
  const [business] = await db.select().from(schema.business).where(eq(schema.business.id, user.businessId));
  const [settings] = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.businessId, user.businessId));
  if (!business || !settings) throw new ServiceError("The business hasn't been set up. Run the seed script.");
  const taxRates = await db
    .select()
    .from(schema.taxRate)
    .where(eq(schema.taxRate.businessId, user.businessId))
    .orderBy(asc(schema.taxRate.position), asc(schema.taxRate.createdAt));
  const sequences = await db
    .select()
    .from(schema.sequence)
    .where(eq(schema.sequence.businessId, user.businessId));
  return {
    business,
    settings,
    taxRates,
    quoteSequence: sequences.find((s) => s.kind === "quote")!,
    invoiceSequence: sequences.find((s) => s.kind === "invoice")!,
  };
}

export type SettingsBundle = Awaited<ReturnType<typeof loadSettings>>;

function audit(
  ctx: RequestContext,
  entityType: string,
  entityId: string,
  action: string,
  data?: Record<string, unknown>,
) {
  return activityInsert(ctx.db, {
    businessId: ctx.user.businessId,
    actor: { type: "user", id: ctx.user.id },
    entityType,
    entityId,
    action,
    data,
  });
}

export async function updateBusinessProfile(
  ctx: RequestContext,
  input: z.output<typeof businessProfileSchema>,
) {
  const { line1, line2, city, state, postalCode, ...rest } = input;
  await ctx.db.batch([
    ctx.db
      .update(schema.business)
      .set({
        ...rest,
        address: {
          line1: line1 ?? undefined,
          line2: line2 ?? undefined,
          city: city ?? undefined,
          state: state ?? undefined,
          postalCode: postalCode ?? undefined,
          country: "Nigeria",
        },
        updatedAt: nowIso(),
      })
      .where(eq(schema.business.id, ctx.user.businessId)),
    audit(ctx, "business", ctx.user.businessId, "settings.profile_updated"),
  ]);
}

export async function updateTaxRegistrations(
  ctx: RequestContext,
  input: z.output<typeof taxRegistrationSchema>,
) {
  await ctx.db.batch([
    ctx.db
      .update(schema.business)
      .set({ ...input, updatedAt: nowIso() })
      .where(eq(schema.business.id, ctx.user.businessId)),
    audit(ctx, "business", ctx.user.businessId, "settings.tax_registrations_updated"),
  ]);
}

/**
 * Creates or edits a tax rate (FR-SET-03). Editing a rate never rewrites sent
 * documents: they froze their rates in the revision content.
 */
export async function saveTaxRate(ctx: RequestContext, input: z.output<typeof taxRateSchema>) {
  if (input.id) {
    const [existing] = await ctx.db
      .select()
      .from(schema.taxRate)
      .where(and(eq(schema.taxRate.id, input.id), eq(schema.taxRate.businessId, ctx.user.businessId)));
    if (!existing) throw new ServiceError("That tax rate no longer exists");
    await ctx.db.batch([
      ctx.db
        .update(schema.taxRate)
        .set({
          name: input.name,
          rateBp: input.rateBp,
          appliesTo: input.appliesTo,
          isDefault: input.isDefault,
          updatedAt: nowIso(),
        })
        .where(eq(schema.taxRate.id, input.id)),
      audit(ctx, "tax_rate", input.id, "tax_rate.updated", { from: existing.rateBp, to: input.rateBp }),
    ]);
    return input.id;
  }
  const id = newId("tax");
  const existing = await ctx.db
    .select()
    .from(schema.taxRate)
    .where(eq(schema.taxRate.businessId, ctx.user.businessId));
  await ctx.db.batch([
    ctx.db.insert(schema.taxRate).values({
      id,
      businessId: ctx.user.businessId,
      createdBy: ctx.user.id,
      name: input.name,
      rateBp: input.rateBp,
      appliesTo: input.appliesTo,
      isDefault: input.isDefault,
      position: existing.length,
    }),
    audit(ctx, "tax_rate", id, "tax_rate.created", { rateBp: input.rateBp }),
  ]);
  return id;
}

export async function setTaxRateArchived(ctx: RequestContext, id: string, archived: boolean) {
  const [existing] = await ctx.db
    .select()
    .from(schema.taxRate)
    .where(and(eq(schema.taxRate.id, id), eq(schema.taxRate.businessId, ctx.user.businessId)));
  if (!existing) throw new ServiceError("That tax rate no longer exists");
  await ctx.db.batch([
    ctx.db
      .update(schema.taxRate)
      .set({
        archivedAt: archived ? nowIso() : null,
        isDefault: archived ? false : existing.isDefault,
        updatedAt: nowIso(),
      })
      .where(eq(schema.taxRate.id, id)),
    audit(ctx, "tax_rate", id, archived ? "tax_rate.archived" : "tax_rate.restored"),
  ]);
}

/** FR-SET-04: prefixes and next numbers; next numbers only increase. */
export async function updateNumbering(ctx: RequestContext, input: z.output<typeof numberingSchema>) {
  const bundle = await loadSettings(ctx);
  const quoteError = validateNextNumber(bundle.quoteSequence.nextValue, input.quoteNext);
  if (quoteError) throw new ServiceError(quoteError, "quoteNext");
  const invoiceError = validateNextNumber(bundle.invoiceSequence.nextValue, input.invoiceNext);
  if (invoiceError) throw new ServiceError(invoiceError, "invoiceNext");
  const seq = schema.sequence;
  await ctx.db.batch([
    // The guard in the WHERE clause keeps "only increase" true even if two saves race.
    ctx.db
      .update(seq)
      .set({ prefix: input.quotePrefix, nextValue: input.quoteNext, updatedAt: nowIso() })
      .where(and(eq(seq.id, bundle.quoteSequence.id), lte(seq.nextValue, input.quoteNext))),
    ctx.db
      .update(seq)
      .set({ prefix: input.invoicePrefix, nextValue: input.invoiceNext, updatedAt: nowIso() })
      .where(and(eq(seq.id, bundle.invoiceSequence.id), lte(seq.nextValue, input.invoiceNext))),
    audit(ctx, "business", ctx.user.businessId, "settings.numbering_updated", {
      quote: `${input.quotePrefix}${input.quoteNext}`,
      invoice: `${input.invoicePrefix}${input.invoiceNext}`,
    }),
  ]);
}

export async function updateDocumentDefaults(
  ctx: RequestContext,
  input: z.output<typeof documentDefaultsSchema>,
) {
  await ctx.db.batch([
    ctx.db
      .update(schema.settings)
      .set({ ...input, updatedAt: nowIso() })
      .where(eq(schema.settings.businessId, ctx.user.businessId)),
    audit(ctx, "business", ctx.user.businessId, "settings.defaults_updated"),
  ]);
}

export async function updatePaymentInstructions(
  ctx: RequestContext,
  input: z.output<typeof paymentInstructionsSchema>,
) {
  await ctx.db.batch([
    ctx.db
      .update(schema.settings)
      .set({ ...input, updatedAt: nowIso() })
      .where(eq(schema.settings.businessId, ctx.user.businessId)),
    audit(ctx, "business", ctx.user.businessId, "settings.payment_instructions_updated"),
  ]);
}

/** FR-SET-09: saved only when it reaches AA on white. */
export async function updateBrandColor(ctx: RequestContext, input: z.output<typeof brandColorSchema>) {
  const check = accessibleBrandColor(input.brandColor);
  if (!check.ok) {
    throw new ServiceError(
      `This colour is too light for text on white (${check.ratio.toFixed(2)}:1, needs 4.5:1). Try ${check.suggestion}.`,
      "brandColor",
    );
  }
  await ctx.db.batch([
    ctx.db
      .update(schema.business)
      .set({ brandColor: input.brandColor, updatedAt: nowIso() })
      .where(eq(schema.business.id, ctx.user.businessId)),
    audit(ctx, "business", ctx.user.businessId, "settings.brand_color_updated", {
      brandColor: input.brandColor,
    }),
  ]);
}

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES: Record<string, string> = { "image/png": "png", "image/svg+xml": "svg" };

/** FR-SET-01: PNG or SVG, at most 2 MB, stored in R2. */
export async function saveLogo(ctx: RequestContext, file: File) {
  const ext = LOGO_TYPES[file.type];
  if (!ext) throw new ServiceError("Upload a PNG or SVG file", "logo");
  if (file.size > LOGO_MAX_BYTES) throw new ServiceError("The logo must be 2 MB or smaller", "logo");
  if (file.size === 0) throw new ServiceError("That file is empty", "logo");
  const bytes = await file.arrayBuffer();
  if (ext === "png" && !isPng(new Uint8Array(bytes)))
    throw new ServiceError("That file isn't a valid PNG", "logo");
  if (ext === "svg" && !/<svg[\s>]/i.test(new TextDecoder().decode(bytes.slice(0, 4096)))) {
    throw new ServiceError("That file isn't a valid SVG", "logo");
  }

  const [business] = await ctx.db
    .select()
    .from(schema.business)
    .where(eq(schema.business.id, ctx.user.businessId));
  const key = `logos/${ctx.user.businessId}/${newId("act").slice(4)}.${ext}`;
  await ctx.env.FILES.put(key, bytes, { httpMetadata: { contentType: file.type } });
  await ctx.db.batch([
    ctx.db
      .update(schema.business)
      .set({ logoKey: key, updatedAt: nowIso() })
      .where(eq(schema.business.id, ctx.user.businessId)),
    audit(ctx, "business", ctx.user.businessId, "settings.logo_updated"),
  ]);
  if (business?.logoKey && business.logoKey !== key) await ctx.env.FILES.delete(business.logoKey);
  return key;
}

export async function removeLogo(ctx: RequestContext) {
  const [business] = await ctx.db
    .select()
    .from(schema.business)
    .where(eq(schema.business.id, ctx.user.businessId));
  if (!business?.logoKey) return;
  await ctx.db.batch([
    ctx.db
      .update(schema.business)
      .set({ logoKey: null, updatedAt: nowIso() })
      .where(eq(schema.business.id, ctx.user.businessId)),
    audit(ctx, "business", ctx.user.businessId, "settings.logo_removed"),
  ]);
  await ctx.env.FILES.delete(business.logoKey);
}

function isPng(bytes: Uint8Array) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return signature.every((b, i) => bytes[i] === b);
}

export async function saveEmailTemplate(ctx: RequestContext, input: z.output<typeof emailTemplateSchema>) {
  if (!EMAIL_TEMPLATE_DEFAULTS[input.template]) throw new ServiceError("Unknown template");
  const { settings } = await loadSettings(ctx);
  const templates = {
    ...settings.emailTemplates,
    [input.template]: { subject: input.subject, body: input.body },
  };
  await ctx.db.batch([
    ctx.db
      .update(schema.settings)
      .set({ emailTemplates: templates, updatedAt: nowIso() })
      .where(eq(schema.settings.businessId, ctx.user.businessId)),
    audit(ctx, "business", ctx.user.businessId, "settings.email_template_updated", {
      template: input.template,
    }),
  ]);
}

export async function resetEmailTemplate(ctx: RequestContext, template: string) {
  const { settings } = await loadSettings(ctx);
  const templates = { ...settings.emailTemplates };
  delete templates[template];
  await ctx.db.batch([
    ctx.db
      .update(schema.settings)
      .set({ emailTemplates: templates, updatedAt: nowIso() })
      .where(eq(schema.settings.businessId, ctx.user.businessId)),
    audit(ctx, "business", ctx.user.businessId, "settings.email_template_reset", { template }),
  ]);
}

/** FR-SET-08: applies to future sends only (reminders read it when they run). */
export async function updateReminderCadence(
  ctx: RequestContext,
  input: z.output<typeof reminderCadenceSchema>,
) {
  await ctx.db.batch([
    ctx.db
      .update(schema.settings)
      .set({ reminderCadence: input, updatedAt: nowIso() })
      .where(eq(schema.settings.businessId, ctx.user.businessId)),
    audit(ctx, "business", ctx.user.businessId, "settings.reminders_updated", { ...input }),
  ]);
}

/** Tax rates that new documents can use: not archived. */
export async function activeTaxRates(ctx: Pick<RequestContext, "db" | "user">) {
  return ctx.db
    .select()
    .from(schema.taxRate)
    .where(and(eq(schema.taxRate.businessId, ctx.user.businessId), isNull(schema.taxRate.archivedAt)))
    .orderBy(asc(schema.taxRate.position));
}

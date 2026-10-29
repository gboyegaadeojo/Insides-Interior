import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { quickCreateClient } from "~/features/clients/service";
import { createInvoiceOnApproval, getInvoice, invoicesForQuote } from "~/features/invoices/service";
import { approveSchema } from "~/features/portal/schema";
import { approveQuote, loadPortalQuote } from "~/features/portal/service";
import { saveDraftSchema } from "~/features/quotes/schema";
import { createQuote, getQuote, quoteShareUrl, saveDraft, sendQuote } from "~/features/quotes/service";
import { loadDocBusiness } from "~/features/settings/doc-business";
import { signatureSchema } from "~/features/settings/schema";
import { loadSettings, removeSignature, saveSignature, ServiceError } from "~/features/settings/service";
import { addDays, businessToday } from "~/lib/dates";
import { schema } from "~/server/db";
import { SEED_IDS } from "~/server/db/seed-sql";
import { ownerContext, seed, testEnv } from "./helpers";

// Owner requests (docs/decisions.md): 85% deposit and 7-day quotes by default,
// the owner's signature on every document, and an invoice drafted the moment a
// client approves.

beforeEach(seed);

const META = { ip: "203.0.113.31", userAgent: "Vitest" };
const TO = { to: "client@example.ng", cc: [], bcc: [] };
const today = businessToday();

/** F1 (₦121,950.56 with VAT) on the business defaults, unless a deposit is given. */
async function quote(deposit: "default" | "none") {
  const ctx = ownerContext();
  const clientId = await quickCreateClient(ctx, {
    displayName: `Owner Req ${crypto.randomUUID().slice(0, 6)}`,
    email: "client@example.ng",
    phone: null,
  });
  const id = await createQuote(ctx, { clientId });
  const created = (await getQuote(ctx, id))!.quote;
  await saveDraft(
    ctx,
    id,
    saveDraftSchema.parse({
      version: 1,
      header: {
        title: "Living room drapery",
        clientId,
        siteId: null,
        validUntil: created.validUntil,
        depositType: deposit === "none" ? null : created.depositType,
        depositValue: deposit === "none" ? null : created.depositValue,
      },
      content: {
        sections: [
          {
            id: "s1",
            title: "Living room",
            lines: [
              {
                id: "a",
                description: "Design consultation",
                qtyMilli: 3000,
                unit: "hour",
                unitPriceCents: 2_500_000,
                taxRateIds: [SEED_IDS.vat],
              },
              {
                id: "b",
                description: "Drapery fabric",
                qtyMilli: 4500,
                unit: "metre",
                unitPriceCents: 854_275,
                taxRateIds: [SEED_IDS.vat],
              },
            ],
          },
        ],
      },
    }),
  );
  return id;
}

async function sendAndApprove(id: string) {
  const ctx = ownerContext();
  await sendQuote(ctx, id, { version: 2, ...TO });
  const [row] = await ctx.db.select().from(schema.quote).where(eq(schema.quote.id, id));
  const url = await quoteShareUrl(testEnv, id, row!.shareTokenSalt!);
  const token = url.slice(url.lastIndexOf("/") + 1);
  const portal = (await loadPortalQuote(testEnv, token))!;
  return approveQuote(
    testEnv,
    token,
    approveSchema.parse({
      intent: "approve",
      revisionId: portal.revision.id,
      options: [],
      signerName: "Amaka Obi",
      signerEmail: "",
      agree: "on",
    }),
    META,
  );
}

describe("defaults: 85% deposit, 7-day quotes", () => {
  it("a new quote asks 85% and is valid 7 days from its first send", async () => {
    const ctx = ownerContext();
    const { settings } = await loadSettings(ctx);
    expect(settings).toMatchObject({ defaultDepositBp: 8500, quoteValidDays: 7 });
    const id = await quote("default");
    const draft = (await getQuote(ctx, id))!.quote;
    expect(draft).toMatchObject({
      depositType: "percent",
      depositValue: 8500,
      validUntil: addDays(today, 7),
    });

    await sendQuote(ctx, id, { version: 2, ...TO });
    expect((await getQuote(ctx, id))!.quote.validUntil).toBe(addDays(today, 7));
  });

  it("keeps a valid-until date the owner picked", async () => {
    const ctx = ownerContext();
    const id = await quote("default");
    const draft = (await getQuote(ctx, id))!;
    await saveDraft(
      ctx,
      id,
      saveDraftSchema.parse({
        version: 2,
        header: {
          title: null,
          clientId: draft.quote.clientId,
          siteId: null,
          validUntil: addDays(today, 21),
          depositType: "percent",
          depositValue: 8500,
        },
        content: { sections: draft.content.sections },
      }),
    );
    await sendQuote(ctx, id, { version: 3, ...TO });
    expect((await getQuote(ctx, id))!.quote.validUntil).toBe(addDays(today, 21));
  });
});

describe("an invoice is drafted when the client approves", () => {
  it("drafts exactly one 85% deposit invoice, locked to the approved quote", async () => {
    const ctx = ownerContext();
    const id = await quote("default");
    const result = await sendAndApprove(id);
    expect(result.invoiceId).toBeTruthy();

    const invoices = await invoicesForQuote(ctx, id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ kind: "deposit", status: "draft", number: null });
    const invoice = (await getInvoice(ctx, invoices[0]!.id))!;
    // 85% of ₦121,950.56 = ₦103,657.976: the portion lines round per tax to within a kobo.
    expect(Math.abs(invoice.totals.computed.totalCents - 10_365_798)).toBeLessThanOrEqual(1);
    expect(invoice.content.sections.flatMap((s) => s.lines).every((l) => l.locked)).toBe(true);
    expect(invoice.content.sections[0]!.lines[0]!.description).toMatch(/Deposit \(85%\)/);

    // Runs once: a second call (or a retried approval) makes nothing more.
    expect(await createInvoiceOnApproval(ctx.db, ctx.user.businessId, id)).toBeNull();
    expect(await invoicesForQuote(ctx, id)).toHaveLength(1);

    const notes = await ctx.db
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.entityId, invoice.invoice.id));
    expect(notes.map((n) => n.type)).toContain("invoice.drafted");
    const [created] = await ctx.db
      .select()
      .from(schema.activity)
      .where(eq(schema.activity.entityId, invoice.invoice.id));
    expect(created).toMatchObject({ actor: "system", action: "invoice.created" });
  });

  it("a quote without a deposit gets a draft for the approved total", async () => {
    const ctx = ownerContext();
    const id = await quote("none");
    await sendAndApprove(id);
    const [only] = await invoicesForQuote(ctx, id);
    expect(only).toMatchObject({ kind: "standard", status: "draft" });
    expect((await getInvoice(ctx, only!.id))!.totals.computed.totalCents).toBe(12_195_056);
  });
});

describe("the owner's signature", () => {
  const strokes = JSON.stringify([
    [10, 80, 40, 40, 80, 70, 120, 30],
    [130, 60, 180, 62],
  ]);

  it("is saved as SVG made on the server and printed on every document", async () => {
    const ctx = ownerContext();
    await saveSignature(
      ctx,
      signatureSchema.parse({
        signature: strokes,
        signatoryName: "Funmi Adeyemi",
        signatoryTitle: "Managing Director",
      }),
    );
    const business = await loadDocBusiness(ctx.db, ctx.user.businessId);
    expect(business.signature).toMatchObject({ name: "Funmi Adeyemi", title: "Managing Director" });
    expect(business.signature!.svg).toMatch(/^<svg[^>]*>.*<path/s);
    expect(business.signature!.svg).not.toMatch(/script|on\w+=/i);

    await removeSignature(ctx);
    expect((await loadDocBusiness(ctx.db, ctx.user.businessId)).signature).toBeNull();
  });

  it("refuses strokes that aren't a drawing", async () => {
    const ctx = ownerContext();
    for (const signature of ["<svg onload=alert(1)>", "[[1]]", "{}"]) {
      await expect(
        saveSignature(ctx, signatureSchema.parse({ signature, signatoryName: "Funmi", signatoryTitle: "" })),
      ).rejects.toBeInstanceOf(ServiceError);
    }
  });
});

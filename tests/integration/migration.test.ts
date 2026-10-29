import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getInvoice } from "~/features/invoices/service";
import { importPlan } from "~/features/migration/service";
import { schema } from "~/server/db";
import { SEED_IDS } from "~/server/db/seed-sql";
import { buildPlan, mergeExports } from "../../scripts/migrate/transform";
import { oldAppExports } from "../fixtures/old-app";
import { ownerContext, seed } from "./helpers";

beforeEach(seed);

describe("importing the old app (SPEC 12)", () => {
  it("loads, reconciles and never imports twice", async () => {
    const ctx = ownerContext();
    const plan = buildPlan(mergeExports(oldAppExports()));
    const receipt = async () => ({ bytes: new Uint8Array([255, 216, 255]), type: "image/jpeg" });
    const report = await importPlan(ctx, plan, { receipt, today: "2026-10-29" });

    expect(report.counts.customers).toMatchObject({ planned: 2, imported: 2 });
    expect(report.counts.invoices).toMatchObject({ planned: 5, imported: 5 });
    expect(report.counts.payments).toMatchObject({ planned: 3, imported: 3 });
    expect(report.counts.expenses).toMatchObject({ imported: 1 });

    // Recomputed totals agree with the old app where its floats were exact.
    const conv = report.totals.find((t) => t.number === "INV-2026-104")!;
    expect(conv.newCents).toBe(conv.legacyCents);

    // Outstanding per client ties out (owner sign-off list).
    const ade = report.clients.find((c) => c.name === "Adaeze Okafor")!;
    expect(ade.newOutstandingCents).toBe(ade.legacyOutstandingCents);

    // Statuses come from the payments; the converted invoice links to its quote and project.
    const [inv] = await ctx.db.select().from(schema.invoice).where(eq(schema.invoice.number, "INV-2026-104"));
    expect(inv).toMatchObject({ status: "partially_paid", issueDate: "2026-07-05", dueDate: "2026-08-04" });
    expect(inv!.quoteId).toBeTruthy();
    expect(inv!.projectId).toBeTruthy();
    expect((await getInvoice(ctx, inv!.id))!.balanceCents).toBe(57_500_00);
    const [dup] = await ctx.db
      .select()
      .from(schema.invoice)
      .where(eq(schema.invoice.number, "INV-2026-105-dup"));
    expect(dup?.status).toBe("void");
    const [lines] = await ctx.db
      .select({ n: schema.invoiceLine.id })
      .from(schema.invoiceLine)
      .where(eq(schema.invoiceLine.invoiceId, inv!.id));
    expect(lines).toBeTruthy();

    // The changes-requested quote keeps the client's comment as the first message.
    const [q] = await ctx.db.select().from(schema.quote).where(eq(schema.quote.number, "QT-2026-011"));
    const [conversation] = await ctx.db
      .select()
      .from(schema.conversation)
      .where(eq(schema.conversation.entityId, q!.id));
    const [message] = await ctx.db
      .select()
      .from(schema.message)
      .where(eq(schema.message.conversationId, conversation!.id));
    expect(message).toMatchObject({ author: "client", body: "Can the curtains be lined?" });
    // Its 8.5% stays as a frozen rate, never as VAT.
    const [rev] = await ctx.db
      .select()
      .from(schema.quoteRevision)
      .where(eq(schema.quoteRevision.id, q!.currentRevisionId!));
    expect(rev!.content.taxRates).toEqual([{ id: "tax_migrated_850", name: "Tax 8.5%", rateBp: 850 }]);
    const [approved] = await ctx.db.select().from(schema.quote).where(eq(schema.quote.number, "QT-2026-010"));
    expect(approved?.status).toBe("approved");
    // Nothing was emailed.
    const emails = await ctx.db
      .select()
      .from(schema.emailMessage)
      .where(eq(schema.emailMessage.entityId, inv!.id));
    expect(emails).toEqual([]);

    // The receipt went to R2.
    const [expense] = await ctx.db.select().from(schema.expense).where(eq(schema.expense.supplier, "Bolt"));
    expect(expense?.category).toBe("transport");
    expect(await ctx.env.FILES.head(expense!.receiptKey!)).not.toBeNull();

    // Sequences are untouched by numbers in another format; a second run adds nothing.
    const again = await importPlan(ctx, plan, { receipt, today: "2026-10-29" });
    expect(again.counts.invoices).toMatchObject({ imported: 0, already: 5 });
    expect(again.counts.customers).toMatchObject({ imported: 0, already: 2 });
    const [seq] = await ctx.db
      .select()
      .from(schema.sequence)
      .where(eq(schema.sequence.id, SEED_IDS.invoiceSeq));
    expect(seq!.nextValue).toBeGreaterThan(0);
  });

  it("starts the sequence above the highest migrated number in the same format", async () => {
    const ctx = ownerContext();
    const [seq] = await ctx.db
      .select()
      .from(schema.sequence)
      .where(eq(schema.sequence.id, SEED_IDS.invoiceSeq));
    const number = `${seq!.prefix}${seq!.nextValue + 500}`;
    const plan = {
      clients: [
        { legacyId: "c1", displayName: "Seq Client", email: null, phone: null, address: null, notes: null },
      ],
      items: [],
      quotes: [],
      invoices: [
        {
          legacyId: `i-${number}`,
          number,
          clientLegacyId: "c1",
          clientName: null,
          issueDate: "2026-09-01",
          lines: [
            { description: "Work", qtyMilli: 1000, unitPriceCents: 1000_00, taxBp: 0, itemType: "service" },
          ],
          notes: null,
          terms: null,
          legacyTotalCents: 1000_00,
          status: "sent",
          dueDate: "2026-09-15",
          legacyBalanceCents: 1000_00,
          fromQuoteNumber: null,
        },
      ],
      payments: [],
      expenses: [],
      warnings: [],
    };
    const report = await importPlan(ctx, plan);
    expect(report.sequences.find((s) => s.kind === "invoice")?.after).toBe(seq!.nextValue + 501);
  });
});

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { quickCreateClient, saveSite } from "~/features/clients/service";
import type { SaveDraftInput } from "~/features/quotes/schema";
import { saveDraftSchema } from "~/features/quotes/schema";
import {
  awaitingSummary,
  createQuote,
  deleteDraft,
  DraftConflictError,
  duplicateQuote,
  getQuote,
  listQuotes,
  saveDraft,
} from "~/features/quotes/service";
import { schema } from "~/server/db";
import { SEED_IDS } from "~/server/db/seed-sql";
import { ownerContext, seed } from "./helpers";

beforeEach(seed);

// SPEC 10.2 fixture F1 (Nigeria): VAT 7.5% on both lines.
const TAXES = [SEED_IDS.vat];

function f1Draft(version: number, clientId: string | null): SaveDraftInput {
  return saveDraftSchema.parse({
    version,
    header: {
      title: "Living room drapery",
      clientId,
      siteId: null,
      validUntil: "2026-12-01",
      depositType: "percent",
      depositValue: 5000,
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
              taxRateIds: TAXES,
            },
            {
              id: "b",
              description: "Drapery fabric",
              details: "<p>Lined <strong>linen</strong><script>x</script></p>",
              qtyMilli: 4500,
              unit: "metre",
              unitPriceCents: 854_275,
              taxRateIds: TAXES,
            },
          ],
        },
      ],
    },
  });
}

describe("quote drafts (FR-QT-01…07)", () => {
  it("creates a numberless draft with defaults from settings", async () => {
    const ctx = ownerContext();
    const id = await createQuote(ctx);
    const detail = await getQuote(ctx, id);
    expect(detail!.quote).toMatchObject({
      status: "draft",
      number: null,
      currency: "NGN",
      draftVersion: 1,
      depositType: "percent",
      depositValue: 5000,
    });
    expect(detail!.content.sections).toHaveLength(1);
    expect(detail!.content.taxRates.map((r) => r.id)).toEqual(TAXES);
  });

  it("saves F1 and recomputes totals on the server: ₦121,950.56", async () => {
    const ctx = ownerContext();
    const clientId = await quickCreateClient(ctx, { displayName: "Amelia Chen", email: null, phone: null });
    const id = await createQuote(ctx, { clientId });
    const result = await saveDraft(ctx, id, f1Draft(1, clientId));
    expect(result.version).toBe(2);
    expect(result.totals).toMatchObject({
      subtotalCents: 11_344_238,
      totalCents: 12_195_056,
      depositCents: 6_097_528,
      balanceCents: 6_097_528,
    });
    const detail = await getQuote(ctx, id);
    expect(detail!.totals.computed.totalCents).toBe(12_195_056);
    // Rich text sanitised on the way in (SPEC 11.1).
    expect(detail!.content.sections[0]!.lines[1]!.details).toBe("<p>Lined <strong>linen</strong></p>");
  });

  it("rejects a stale version so two tabs can't overwrite each other (FR-QT-06)", async () => {
    const ctx = ownerContext();
    const id = await createQuote(ctx);
    await saveDraft(ctx, id, f1Draft(1, null));
    await expect(saveDraft(ctx, id, f1Draft(1, null))).rejects.toBeInstanceOf(DraftConflictError);
    const error = await saveDraft(ctx, id, f1Draft(1, null)).catch((e) => e);
    expect(error.serverVersion).toBe(2);
    expect((await saveDraft(ctx, id, f1Draft(2, null))).version).toBe(3);
  });

  it("refuses a site from another client", async () => {
    const ctx = ownerContext();
    const a = await quickCreateClient(ctx, { displayName: "A", email: null, phone: null });
    const b = await quickCreateClient(ctx, { displayName: "B", email: null, phone: null });
    const siteOfB = await saveSite(ctx, b, {
      label: "B",
      line1: null,
      line2: null,
      city: null,
      state: null,
      postalCode: null,
    });
    const id = await createQuote(ctx, { clientId: a });
    const draft = f1Draft(1, a);
    draft.header.siteId = siteOfB;
    await expect(saveDraft(ctx, id, draft)).rejects.toThrow(/another client/);
  });

  it("drops tax ids that don't exist", async () => {
    const ctx = ownerContext();
    const id = await createQuote(ctx);
    const draft = f1Draft(1, null);
    draft.content.sections[0]!.lines[0]!.taxRateIds = [SEED_IDS.vat, "tax_made_up"];
    await saveDraft(ctx, id, draft);
    const detail = await getQuote(ctx, id);
    expect(detail!.content.sections[0]!.lines[0]!.taxRateIds).toEqual([SEED_IDS.vat]);
  });

  it("won't edit a sent quote", async () => {
    const ctx = ownerContext();
    const id = await createQuote(ctx);
    await ctx.db.update(schema.quote).set({ status: "sent" }).where(eq(schema.quote.id, id));
    await expect(saveDraft(ctx, id, f1Draft(1, null))).rejects.toThrow(/revision/);
  });
});

describe("listing, duplicating, deleting", () => {
  it("lists drafts with totals from their content and counts by status", async () => {
    const ctx = ownerContext();
    const clientId = await quickCreateClient(ctx, { displayName: "Kwame Mensah", email: null, phone: null });
    const id = await createQuote(ctx, { clientId });
    await saveDraft(ctx, id, f1Draft(1, clientId));
    const { quotes, counts } = await listQuotes(ctx, { filter: "draft" });
    const row = quotes.find((q) => q.id === id)!;
    expect(row).toMatchObject({ clientName: "Kwame Mensah", totalCents: 12_195_056, number: null });
    expect(counts.draft).toBeGreaterThanOrEqual(1);
    expect((await listQuotes(ctx, { query: "kwame" })).quotes.map((q) => q.id)).toContain(id);
  });

  it("duplicates with fresh line ids and deletes only drafts", async () => {
    const ctx = ownerContext();
    const id = await createQuote(ctx);
    await saveDraft(ctx, id, f1Draft(1, null));
    const copyId = await duplicateQuote(ctx, id);
    const copy = await getQuote(ctx, copyId);
    expect(copy!.quote.title).toBe("Living room drapery (copy)");
    expect(copy!.content.sections[0]!.lines.map((l) => l.id)).not.toContain("a");
    expect(copy!.totals.computed.totalCents).toBe(12_195_056);

    await deleteDraft(ctx, copyId);
    expect(await getQuote(ctx, copyId)).toBeNull();
    await ctx.db.update(schema.quote).set({ status: "sent" }).where(eq(schema.quote.id, id));
    await expect(deleteDraft(ctx, id)).rejects.toThrow(/kept/);
  });
});

describe("list performance (Workers Free CPU budget)", () => {
  it("stores the draft total on save and lists it without re-totalling", async () => {
    const ctx = ownerContext();
    const id = await createQuote(ctx);
    await saveDraft(ctx, id, f1Draft(1, null));
    const [row] = await ctx.db.select().from(schema.quote).where(eq(schema.quote.id, id));
    expect(row!.draftTotalCents).toBe(12_195_056);
    const listed = (await listQuotes(ctx, { filter: "draft" })).quotes.find((q) => q.id === id);
    expect(listed!.totalCents).toBe(12_195_056);
  });

  it("still totals drafts saved before totals were stored", async () => {
    const ctx = ownerContext();
    const id = await createQuote(ctx);
    await saveDraft(ctx, id, f1Draft(1, null));
    await ctx.db.update(schema.quote).set({ draftTotalCents: null }).where(eq(schema.quote.id, id));
    const listed = (await listQuotes(ctx)).quotes.find((q) => q.id === id);
    expect(listed!.totalCents).toBe(12_195_056);
  });

  it("pages in SQL and counts every quote", async () => {
    const ctx = ownerContext();
    for (let i = 0; i < 3; i++) await createQuote(ctx);
    const page = await listQuotes(ctx, { limit: 2 });
    expect(page.quotes).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    const statuses = await ctx.db.select({ status: schema.quote.status }).from(schema.quote);
    expect(page.counts.all).toBe(statuses.length);
    expect(page.counts.draft).toBe(statuses.filter((r) => r.status === "draft").length);
  });

  it("treats % and _ in a search as literal characters", async () => {
    const ctx = ownerContext();
    const id = await createQuote(ctx);
    const draft = f1Draft(1, null);
    draft.header.title = "100% wool throw";
    await saveDraft(ctx, id, draft);
    await createQuote(ctx);
    const found = (await listQuotes(ctx, { query: "100%" })).quotes.map((q) => q.id);
    expect(found).toEqual([id]);
    expect((await listQuotes(ctx, { query: "_" })).quotes).toHaveLength(0);
  });

  it("counts quotes awaiting an answer", async () => {
    const ctx = ownerContext();
    const before = await awaitingSummary(ctx);
    const id = await createQuote(ctx);
    await ctx.db.update(schema.quote).set({ status: "viewed" }).where(eq(schema.quote.id, id));
    expect(await awaitingSummary(ctx)).toEqual({ count: before.count + 1, totalCents: before.totalCents });
  });
});

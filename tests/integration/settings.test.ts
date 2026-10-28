import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  activeTaxRates,
  loadSettings,
  saveLogo,
  saveTaxRate,
  ServiceError,
  setTaxRateArchived,
  updateBrandColor,
  updateNumbering,
} from "~/features/settings/service";
import { schema } from "~/server/db";
import { ownerContext, seed, testEnv } from "./helpers";

beforeEach(seed);

describe("seed (SPEC 14.4 phase 2)", () => {
  it("creates the business, GST 5%, MB PST 7% and both sequences", async () => {
    const bundle = await loadSettings(ownerContext());
    expect(bundle.taxRates.map((r) => [r.name, r.rateBp])).toEqual([
      ["GST", 500],
      ["PST (MB RST)", 700],
    ]);
    expect(bundle.quoteSequence).toMatchObject({ prefix: "Q-", nextValue: 1001 });
    expect(bundle.invoiceSequence).toMatchObject({ prefix: "INV-", nextValue: 1001 });
  });

  it("is idempotent", async () => {
    await seed();
    const rates = await ownerContext().db.select().from(schema.taxRate);
    expect(rates).toHaveLength(2);
  });
});

describe("numbering (FR-SET-04)", () => {
  it("lets the next number go up and records activity", async () => {
    const ctx = ownerContext();
    await updateNumbering(ctx, {
      quotePrefix: "Q-",
      quoteNext: 2001,
      invoicePrefix: "INV-",
      invoiceNext: 1500,
    });
    const bundle = await loadSettings(ctx);
    expect(bundle.quoteSequence.nextValue).toBe(2001);
    expect(bundle.invoiceSequence.nextValue).toBe(1500);
    const activity = await ctx.db
      .select()
      .from(schema.activity)
      .where(eq(schema.activity.action, "settings.numbering_updated"));
    expect(activity).toHaveLength(1);
  });

  it("refuses to go down", async () => {
    const ctx = ownerContext();
    await updateNumbering(ctx, {
      quotePrefix: "Q-",
      quoteNext: 3000,
      invoicePrefix: "INV-",
      invoiceNext: 3000,
    });
    await expect(
      updateNumbering(ctx, { quotePrefix: "Q-", quoteNext: 2999, invoicePrefix: "INV-", invoiceNext: 3000 }),
    ).rejects.toThrow(ServiceError);
    expect((await loadSettings(ctx)).quoteSequence.nextValue).toBe(3000);
  });
});

describe("tax rates (FR-SET-03)", () => {
  it("adds, edits and archives without deleting", async () => {
    const ctx = ownerContext();
    const id = await saveTaxRate(ctx, { name: "HST", rateBp: 1300, appliesTo: "both", isDefault: false });
    await saveTaxRate(ctx, { id, name: "HST (ON)", rateBp: 1300, appliesTo: "services", isDefault: false });
    await setTaxRateArchived(ctx, id, true);
    const active = await activeTaxRates(ctx);
    expect(active.map((r) => r.name)).not.toContain("HST (ON)");
    const [archived] = await ctx.db
      .select()
      .from(schema.taxRate)
      .where(and(eq(schema.taxRate.id, id)));
    expect(archived).toMatchObject({ name: "HST (ON)", appliesTo: "services" });
    expect(archived!.archivedAt).not.toBeNull();
  });
});

describe("branding (FR-SET-09)", () => {
  it("saves an accessible colour and refuses one that fails AA", async () => {
    const ctx = ownerContext();
    await updateBrandColor(ctx, { brandColor: "#8E3B7E" });
    expect((await loadSettings(ctx)).business.brandColor).toBe("#8E3B7E");
    await expect(updateBrandColor(ctx, { brandColor: "#F2C94C" })).rejects.toThrow(/too light/);
  });
});

describe("logo (FR-SET-01)", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  it("stores a PNG in R2 and replaces the previous one", async () => {
    const ctx = ownerContext();
    const first = await saveLogo(ctx, new File([png], "logo.png", { type: "image/png" }));
    const second = await saveLogo(ctx, new File([png], "logo.png", { type: "image/png" }));
    expect(await testEnv.FILES.get(second)).not.toBeNull();
    expect(await testEnv.FILES.get(first)).toBeNull();
    expect((await loadSettings(ctx)).business.logoKey).toBe(second);
  });

  it("rejects other types, fake PNGs and files over 2 MB", async () => {
    const ctx = ownerContext();
    await expect(saveLogo(ctx, new File(["gif"], "a.gif", { type: "image/gif" }))).rejects.toThrow(
      /PNG or SVG/,
    );
    await expect(saveLogo(ctx, new File(["not a png"], "a.png", { type: "image/png" }))).rejects.toThrow(
      /valid PNG/,
    );
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(png);
    await expect(saveLogo(ctx, new File([big], "a.png", { type: "image/png" }))).rejects.toThrow(/2 MB/);
  });
});

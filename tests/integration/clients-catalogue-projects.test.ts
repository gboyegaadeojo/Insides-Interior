import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createItem,
  listItems,
  listTemplates,
  saveTemplate,
  setItemArchived,
  updateItem,
} from "~/features/catalogue/service";
import {
  archiveSite,
  clientOptions,
  createClient,
  getClient,
  listClients,
  quickCreateClient,
  saveContact,
  saveSite,
  setClientArchived,
} from "~/features/clients/service";
import { createProject, getProject, listProjects } from "~/features/projects/service";
import { newId } from "~/lib/ids";
import { schema } from "~/server/db";
import { SEED_IDS } from "~/server/db/seed-sql";
import { ownerContext, seed } from "./helpers";

beforeEach(seed);

const blankAddress = { line1: null, line2: null, city: null, province: null, postalCode: null };

describe("clients (SPEC 5.3)", () => {
  it("quick-creates with three fields and appears in the picker (FR-CLI-01)", async () => {
    const ctx = ownerContext();
    const id = await quickCreateClient(ctx, {
      displayName: "Amelia Chen",
      email: "amelia@example.com",
      phone: "204-555-0142",
    });
    expect((await clientOptions(ctx)).map((c) => c.id)).toContain(id);
  });

  it("searches name, email, phone digits and site address (FR-CLI-04)", async () => {
    const ctx = ownerContext();
    const id = await createClient(ctx, {
      displayName: "Kwame Mensah",
      company: null,
      email: "kwame@example.com",
      phone: "(204) 555-0199",
      ...blankAddress,
      notes: null,
      tags: [],
    });
    await saveSite(ctx, id, {
      label: "Cottage",
      line1: "12 Lakeshore Rd",
      line2: null,
      city: "Gimli",
      province: "MB",
      postalCode: null,
    });
    for (const q of ["kwame", "KWAME@EX", "2045550199", "lakeshore", "gimli"]) {
      expect(
        (await listClients(ctx, { query: q })).map((c) => c.id),
        q,
      ).toContain(id);
    }
    expect(await listClients(ctx, { query: "nobody-here" })).toHaveLength(0);
  });

  it("treats LIKE wildcards literally", async () => {
    const ctx = ownerContext();
    await quickCreateClient(ctx, { displayName: "Plain Name", email: null, phone: null });
    expect(await listClients(ctx, { query: "%" })).toHaveLength(0);
  });

  it("keeps one primary contact and archives instead of deleting (FR-CLI-02/05)", async () => {
    const ctx = ownerContext();
    const id = await quickCreateClient(ctx, { displayName: "Sophie Tremblay", email: null, phone: null });
    await saveContact(ctx, id, { name: "Sophie", email: null, phone: null, role: null, isPrimary: true });
    await saveContact(ctx, id, { name: "Marc", email: null, phone: null, role: "Partner", isPrimary: true });
    const detail = await getClient(ctx, id);
    expect(detail!.contacts.filter((c) => c.isPrimary).map((c) => c.name)).toEqual(["Marc"]);

    const siteId = await saveSite(ctx, id, { label: "Home", ...blankAddress });
    await archiveSite(ctx, id, siteId);
    expect((await getClient(ctx, id))!.sites).toHaveLength(0);

    await setClientArchived(ctx, id, true);
    expect((await clientOptions(ctx)).map((c) => c.id)).not.toContain(id);
    expect((await listClients(ctx, { archived: true })).map((c) => c.id)).toContain(id);
    const [row] = await ctx.db.select().from(schema.client).where(eq(schema.client.id, id));
    expect(row).toBeDefined();
  });

  it("computes balances from invoices and payments, not the client row (FR-CLI-03)", async () => {
    const ctx = ownerContext();
    const clientId = await quickCreateClient(ctx, { displayName: "Raj Patel", email: null, phone: null });
    const invoiceId = newId("inv");
    const revisionId = newId("irv");
    await ctx.db.batch([
      ctx.db.insert(schema.invoice).values({
        id: invoiceId,
        businessId: SEED_IDS.business,
        clientId,
        status: "sent",
        number: "INV-9001",
        currentRevisionId: revisionId,
      }),
      ctx.db.insert(schema.invoiceRevision).values({
        id: revisionId,
        invoiceId,
        revisionNo: 1,
        content: { sections: [], taxRates: [] },
        subtotalCents: 50000,
        discountCents: 0,
        taxCents: 3467,
        totalCents: 53467,
        contentHash: "test",
      }),
      ctx.db.insert(schema.payment).values({
        id: newId("pay"),
        businessId: SEED_IDS.business,
        invoiceId,
        clientId,
        amountCents: 20000,
        method: "etransfer",
        receivedOn: "2026-10-28",
      }),
      ctx.db.insert(schema.payment).values({
        id: newId("pay"),
        businessId: SEED_IDS.business,
        invoiceId,
        clientId,
        amountCents: 5000,
        method: "cash",
        receivedOn: "2026-10-28",
        deletedAt: "2026-10-28T00:00:00Z",
      }),
    ]);
    const detail = await getClient(ctx, clientId);
    expect(detail!.balance).toMatchObject({ billedCents: 53467, paidCents: 20000, outstandingCents: 33467 });
    const [row] = await listClients(ctx, { query: "Raj" });
    expect(row!.outstandingCents).toBe(33467);
  });
});

describe("catalogue (SPEC 5.4)", () => {
  it("derives markup from cost and price and keeps only known taxes (FR-CAT-02)", async () => {
    const ctx = ownerContext();
    const id = await createItem(ctx, {
      type: "product",
      name: "Drapery fabric",
      description: null,
      unit: "yard",
      priceCents: 4275,
      costCents: 2850,
      supplier: "Kravet",
      sku: "KR-101",
      taxIds: [SEED_IDS.gst, "tax_not_real"],
    });
    let [item] = await listItems(ctx, { query: "kr-101" });
    expect(item).toMatchObject({ id, markupBp: 5000, defaultTaxIds: [SEED_IDS.gst] });

    await updateItem(ctx, id, {
      ...item!,
      unit: "yard",
      description: null,
      supplier: null,
      sku: null,
      costCents: null,
      taxIds: [],
    });
    [item] = await listItems(ctx, { query: "drapery" });
    expect(item!.markupBp).toBeNull();

    await setItemArchived(ctx, id, true);
    expect(await listItems(ctx)).toHaveLength(0);
    expect(await listItems(ctx, { archived: true })).toHaveLength(1);
  });

  it("saves room templates with ordered lines and replaces them on edit (FR-CAT-04)", async () => {
    const ctx = ownerContext();
    const fabric = await createItem(ctx, {
      type: "product",
      name: "Fabric",
      description: null,
      unit: "yard",
      priceCents: 4275,
      costCents: null,
      supplier: null,
      sku: null,
      taxIds: [],
    });
    const install = await createItem(ctx, {
      type: "service",
      name: "Install",
      description: null,
      unit: "hour",
      priceCents: 9500,
      costCents: null,
      supplier: null,
      sku: null,
      taxIds: [],
    });
    const id = await saveTemplate(ctx, null, {
      name: "Primary bedroom refresh",
      color: "plum",
      lines: [
        { itemId: fabric, qtyMilli: 4500, position: 0 },
        { itemId: install, qtyMilli: 3000, position: 1 },
      ],
    });
    let [template] = await listTemplates(ctx);
    expect(template!.lines.map((l) => [l.name, l.qtyMilli])).toEqual([
      ["Fabric", 4500],
      ["Install", 3000],
    ]);
    await saveTemplate(ctx, id, {
      name: "Primary bedroom",
      color: "sage",
      lines: [{ itemId: install, qtyMilli: 2000, position: 0 }],
    });
    [template] = await listTemplates(ctx);
    expect(template).toMatchObject({ name: "Primary bedroom", color: "sage" });
    expect(template!.lines).toHaveLength(1);
  });

  it("refuses templates with unknown items", async () => {
    await expect(
      saveTemplate(ownerContext(), null, {
        name: "X",
        color: "teal",
        lines: [{ itemId: "itm_missing", qtyMilli: 1000, position: 0 }],
      }),
    ).rejects.toThrow(/no longer exists/);
  });
});

describe("projects (SPEC 5.5)", () => {
  it("belongs to a client and site, with figures from the view", async () => {
    const ctx = ownerContext();
    const clientId = await quickCreateClient(ctx, { displayName: "Olivia Brown", email: null, phone: null });
    const siteId = await saveSite(ctx, clientId, { label: "Home", ...blankAddress });
    const id = await createProject(ctx, { name: "Main floor drapery", clientId, siteId });
    const [row] = await listProjects(ctx);
    expect(row).toMatchObject({ id, clientName: "Olivia Brown", siteLabel: "Home", contractCents: 0 });
    expect(row!.progress.remainingPct).toBe(100);
    expect((await getProject(ctx, id))!.project.name).toBe("Main floor drapery");
  });

  it("rejects a site from another client", async () => {
    const ctx = ownerContext();
    const a = await quickCreateClient(ctx, { displayName: "A", email: null, phone: null });
    const b = await quickCreateClient(ctx, { displayName: "B", email: null, phone: null });
    const siteOfB = await saveSite(ctx, b, { label: "B home", ...blankAddress });
    await expect(createProject(ctx, { name: "Mixed", clientId: a, siteId: siteOfB })).rejects.toThrow(
      /another client/,
    );
  });
});

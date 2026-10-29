import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { rechargeCents } from "~/domain/reports";
import { quickCreateClient } from "~/features/clients/service";
import { expenseSchema } from "~/features/expenses/schema";
import {
  billExpenses,
  createExpense,
  deleteExpense,
  expenseSummary,
  listExpenses,
  updateExpense,
  uploadReceipt,
} from "~/features/expenses/service";
import { recordPaymentSchema, saveInvoiceDraftSchema } from "~/features/invoices/schema";
import {
  createInvoice,
  deleteInvoiceDraft,
  getInvoice,
  outstandingSummary,
  recordPayment,
  saveInvoiceDraft,
  sendInvoice,
  voidInvoice,
} from "~/features/invoices/service";
import { createProject } from "~/features/projects/service";
import {
  agedReceivables,
  exportCsv,
  exportPdfList,
  homeKpis,
  needsYou,
  revenueReport,
  revenueVsExpenses,
  salesTaxReport,
} from "~/features/reports/service";
import { ServiceError } from "~/features/settings/service";
import { addDays, businessToday } from "~/lib/dates";
import { schema } from "~/server/db";
import { SEED_IDS } from "~/server/db/seed-sql";
import { ownerContext, seed } from "./helpers";

beforeEach(seed);

const TO = { to: "client@example.ng", cc: [], bcc: [] };
const today = businessToday();
const period = { from: today, to: today };

type LineIn = {
  description: string;
  cents: number;
  qty?: number;
  vat?: boolean;
  type?: "service" | "product" | "fee";
};

async function sentInvoice(lines: LineIn[], clientId?: string) {
  const ctx = ownerContext();
  const client =
    clientId ??
    (await quickCreateClient(ctx, {
      displayName: `Report Client ${crypto.randomUUID().slice(0, 6)}`,
      email: "client@example.ng",
      phone: null,
    }));
  const id = await createInvoice(ctx, { clientId: client });
  await saveInvoiceDraft(
    ctx,
    id,
    saveInvoiceDraftSchema.parse({
      version: 1,
      header: {
        title: "Report test",
        clientId: client,
        siteId: null,
        poReference: null,
        termsDays: 14,
        dueDate: null,
      },
      content: {
        sections: [
          {
            id: "s",
            title: "Room",
            lines: lines.map((l, n) => ({
              id: `l${n}`,
              itemType: l.type ?? "service",
              description: l.description,
              qtyMilli: l.qty ?? 1000,
              unit: "each",
              unitPriceCents: l.cents,
              taxRateIds: l.vat ? [SEED_IDS.vat] : [],
            })),
          },
        ],
      },
    }),
  );
  const detail = (await getInvoice(ctx, id))!;
  await sendInvoice(ctx, id, { version: detail.invoice.draftVersion, ...TO });
  const after = (await getInvoice(ctx, id))!;
  return { id, clientId: client, total: after.revision!.totalCents, tax: after.revision!.taxCents };
}

function pay(id: string, amountCents: number, whtCents = 0) {
  return recordPayment(
    ownerContext(),
    id,
    recordPaymentSchema.parse({
      receivedOn: today,
      method: "bank",
      amountCents: String(amountCents),
      whtCents: String(whtCents),
      whtRateBp: whtCents ? "500" : undefined,
    }),
  );
}

/** Independent sums straight from the source rows. */
async function sourceTotals() {
  const ctx = ownerContext();
  const i = schema.invoice;
  const r = schema.invoiceRevision;
  const [inv] = await ctx.db
    .select({
      totalCents: sql<number>`coalesce(sum(${r.totalCents}), 0)`,
      taxCents: sql<number>`coalesce(sum(${r.taxCents}), 0)`,
    })
    .from(i)
    .innerJoin(r, eq(r.id, i.currentRevisionId))
    .where(
      and(
        eq(i.businessId, SEED_IDS.business),
        sql`${i.status} not in ('draft','void')`,
        eq(i.issueDate, today),
      ),
    );
  const [pays] = await ctx.db
    .select({
      cents: sql<number>`coalesce(sum(${schema.payment.amountCents} + ${schema.payment.whtCents}), 0)`,
    })
    .from(schema.payment)
    .innerJoin(i, eq(i.id, schema.payment.invoiceId))
    .where(and(isNull(schema.payment.deletedAt), ne(i.status, "void"), eq(schema.payment.receivedOn, today)));
  const [exp] = await ctx.db
    .select({
      amountCents: sql<number>`coalesce(sum(${schema.expense.amountCents}), 0)`,
      vatCents: sql<number>`coalesce(sum(${schema.expense.vatCents}), 0)`,
    })
    .from(schema.expense)
    .where(and(isNull(schema.expense.deletedAt), eq(schema.expense.date, today)));
  return {
    invoicedCents: inv!.totalCents,
    taxCents: inv!.taxCents,
    netCents: inv!.totalCents - inv!.taxCents,
    paymentsCents: pays!.cents,
    expenseNetCents: exp!.amountCents - exp!.vatCents,
    expenseVatCents: exp!.vatCents,
  };
}

const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);

/** Parses our CSV (quoted fields, CRLF) enough to total a column. */
function csvColumn(csv: string, header: string) {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .trim()
    .split("\r\n");
  const split = (line: string) => line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, ""));
  const index = split(lines[0]!).indexOf(header);
  expect(index).toBeGreaterThanOrEqual(0);
  return lines.slice(1).map((l) => split(l)[index]!);
}
const kobo = (text: string) => Math.round(Number(text) * 100);

describe("reports reconcile to source rows (SPEC 5.11)", () => {
  it("revenue, VAT, ageing, Home and the CSV export all tie out", async () => {
    const a = await sentInvoice([
      { description: "Design consultation", cents: 25_000_00, qty: 3000, vat: true },
      { description: "Drapery fabric", cents: 8_542_75, qty: 4500, vat: true, type: "product" },
    ]);
    const b = await sentInvoice([
      { description: "Blinds", cents: 120_000_00, vat: true, type: "product" },
      { description: "Delivery", cents: 7_500_33, type: "fee" },
    ]);
    const c = await sentInvoice([{ description: "Styling", cents: 40_000_00 }], b.clientId);
    const voided = await sentInvoice([{ description: "Mistake", cents: 9_999_99, vat: true }]);
    await voidInvoice(ownerContext(), voided.id, { reason: "Sent in error", reissue: false });

    await pay(a.id, Math.floor(a.total / 3));
    await pay(b.id, b.total - 6_000_00, 6_000_00);
    await pay(c.id, c.total);

    const src = await sourceTotals();
    const ctx = ownerContext();

    // Accrual: invoices issued in the period.
    const vat = await salesTaxReport(ctx, period, "accrual");
    expect(vat.collectedCents).toBe(src.taxCents);
    expect(vat.salesCents).toBe(src.netCents);
    expect(vat.taxes.find((t) => t.id === SEED_IDS.vat)?.rateBp).toBe(750);

    const revenue = await revenueReport(ctx, period, "accrual");
    expect(revenue.totalCents).toBe(src.netCents);
    expect(sum(revenue.months, (m) => m.cents)).toBe(src.netCents);
    expect(sum(revenue.clients, (m) => m.cents)).toBe(src.netCents);
    expect(sum(revenue.types, (m) => m.cents)).toBe(src.netCents);

    // Cash: a third of A, all of B (with WHT) and C.
    const cashVat = await salesTaxReport(ctx, period, "cash");
    const cashRevenue = await revenueReport(ctx, period, "cash");
    expect(cashVat.collectedCents).toBeLessThan(vat.collectedCents);
    expect(sum(cashRevenue.types, (m) => m.cents)).toBe(cashRevenue.totalCents);
    expect(sum(cashRevenue.clients, (m) => m.cents)).toBe(cashRevenue.totalCents);
    // Once everything is paid in the period, cash and accrual agree exactly.
    await pay(a.id, a.total - Math.floor(a.total / 3));
    const settledVat = await salesTaxReport(ctx, period, "cash");
    const settledRevenue = await revenueReport(ctx, period, "cash");
    expect((await getInvoice(ctx, voided.id))!.invoice.status).toBe("void");
    expect(settledVat.collectedCents).toBe(vat.collectedCents);
    expect(settledRevenue.totalCents).toBe(revenue.totalCents);

    // Ageing ties to the open balances, and every invoice is in one bucket.
    const open = await outstandingSummary(ctx);
    const aged = await agedReceivables(ctx);
    expect(aged.total.totalCents).toBe(open.outstandingCents);
    expect(sum(aged.clients, (x) => x.totalCents)).toBe(aged.total.totalCents);
    const later = await agedReceivables(ctx, addDays(today, 40));
    expect(later.total.totalCents).toBe(aged.total.totalCents);
    expect(later.total["1-30"]).toBe(aged.total.current);

    const kpis = await homeKpis(ctx);
    expect(kpis.outstandingCents).toBe(open.outstandingCents);
    if (today.slice(0, 7) === kpis.monthStart.slice(0, 7)) {
      const [month] = await ctx.db
        .select({
          cents: sql<number>`coalesce(sum(${schema.payment.amountCents} + ${schema.payment.whtCents}), 0)`,
        })
        .from(schema.payment)
        .innerJoin(schema.invoice, eq(schema.invoice.id, schema.payment.invoiceId))
        .where(
          and(
            isNull(schema.payment.deletedAt),
            ne(schema.invoice.status, "void"),
            sql`${schema.payment.receivedOn} >= ${kpis.monthStart}`,
          ),
        );
      expect(kpis.paidMonthCents).toBe(month!.cents);
    }

    // CSV: totals in the file equal the rows they came from.
    const invoicesCsv = await exportCsv(ctx, "invoices", period);
    expect(invoicesCsv.startsWith("\uFEFFInvoice number,")).toBe(true);
    const statuses = csvColumn(invoicesCsv, "Status");
    const totals = csvColumn(invoicesCsv, "Total (NGN)").map(kobo);
    const live = totals.filter((_, n) => statuses[n] !== "Void");
    expect(sum(live, (x) => x)).toBe(src.invoicedCents);
    const vatColumn = csvColumn(invoicesCsv, "VAT (NGN)")
      .map(kobo)
      .filter((_, n) => statuses[n] !== "Void");
    expect(sum(vatColumn, (x) => x)).toBe(src.taxCents);

    const paymentsCsv = await exportCsv(ctx, "payments", period);
    const settled = csvColumn(paymentsCsv, "Settled on invoice (NGN)").map(kobo);
    const voidFlags = csvColumn(paymentsCsv, "Invoice void");
    const after = await sourceTotals();
    expect(
      sum(
        settled.filter((_, n) => voidFlags[n] === "No"),
        (x) => x,
      ),
    ).toBe(after.paymentsCents);
    expect(csvColumn(paymentsCsv, "WHT deducted (NGN)").map(kobo)).toContain(6_000_00);

    const pdfs = await exportPdfList(ctx, period);
    for (const inv of [a, b, c]) expect(pdfs.some((x) => x.id === inv.id)).toBe(true);
    expect(pdfs.every((x) => x.filename.endsWith(".pdf"))).toBe(true);

    const chart = await revenueVsExpenses(ctx, { from: `${today.slice(0, 8)}01`, to: today });
    expect(chart).toHaveLength(1);
    const [monthRevenue] = await ctx.db
      .select({
        cents: sql<number>`coalesce(sum(${schema.invoiceRevision.totalCents} - ${schema.invoiceRevision.taxCents}), 0)`,
      })
      .from(schema.invoice)
      .innerJoin(schema.invoiceRevision, eq(schema.invoiceRevision.id, schema.invoice.currentRevisionId))
      .where(
        and(
          sql`${schema.invoice.status} not in ('draft','void')`,
          sql`${schema.invoice.issueDate} >= ${`${today.slice(0, 8)}01`}`,
          sql`${schema.invoice.issueDate} <= ${today}`,
        ),
      );
    expect(chart[0]!.revenueCents).toBe(monthRevenue!.cents);
  });

  it("Needs you lists overdue invoices, quotes awaiting and drafts with one action each", async () => {
    const ctx = ownerContext();
    const draft = await createInvoice(ctx);
    const items = await needsYou(ctx, 20);
    const mine = items.find((x) => x.key === draft);
    expect(mine).toMatchObject({ kind: "draft", action: "Continue", to: `/invoices/${draft}` });
    expect(items.every((x) => x.action && x.to.startsWith("/"))).toBe(true);
  });
});

describe("expenses (SPEC 5.10)", () => {
  async function project() {
    const ctx = ownerContext();
    const clientId = await quickCreateClient(ctx, {
      displayName: `Expense Client ${crypto.randomUUID().slice(0, 6)}`,
      email: "client@example.ng",
      phone: null,
    });
    const projectId = await createProject(ctx, { name: "Lekki flat", clientId, siteId: null });
    return { clientId, projectId };
  }

  const form = (v: Record<string, string>) =>
    expenseSchema.parse({
      date: today,
      supplier: "Balogun Market",
      category: "fabric",
      amountCents: "10,750.00",
      ...v,
    });

  it("stores the receipt first, then the expense, and nets VAT in reports", async () => {
    const ctx = ownerContext();
    const receipt = await uploadReceipt(
      ctx,
      new File([new Uint8Array([255, 216, 255])], "r.jpg", { type: "image/jpeg" }),
    );
    expect(receipt.key.startsWith(`receipts/${SEED_IDS.business}/`)).toBe(true);
    expect(await ctx.env.FILES.head(receipt.key)).not.toBeNull();

    const before = await salesTaxReport(ctx, period, "accrual");
    const id = await createExpense(ctx, form({ vatCents: "750", receiptKey: receipt.key }));
    const after = await salesTaxReport(ctx, period, "accrual");
    expect(after.paidOnExpensesCents - before.paidOnExpensesCents).toBe(750_00);
    expect(after.netCents).toBe(after.collectedCents - after.paidOnExpensesCents);

    const { expenses } = await listExpenses(ctx, { query: "balogun" });
    expect(expenses.find((e) => e.id === id)).toMatchObject({
      amountCents: 10_750_00,
      vatCents: 750_00,
      billed: false,
    });

    const src = await sourceTotals();
    const summary = await expenseSummary(ctx, { from: today, to: today });
    expect(summary.netCents).toBe(src.expenseNetCents);
    const csv = await exportCsv(ctx, "expenses", period);
    expect(sum(csvColumn(csv, "Net of VAT (NGN)").map(kobo), (x) => x)).toBe(src.expenseNetCents);
    expect(sum(csvColumn(csv, "VAT paid (NGN)").map(kobo), (x) => x)).toBe(src.expenseVatCents);
  });

  it("rejects bad receipts and receipts from elsewhere", async () => {
    const ctx = ownerContext();
    await expect(
      uploadReceipt(ctx, new File(["x"], "a.exe", { type: "application/x-msdownload" })),
    ).rejects.toThrow(ServiceError);
    await expect(uploadReceipt(ctx, new File([], "a.jpg", { type: "image/jpeg" }))).rejects.toThrow(
      ServiceError,
    );
    await expect(createExpense(ctx, form({ receiptKey: "receipts/biz_other/x.jpg" }))).rejects.toThrow(
      "Upload the receipt again",
    );
    await expect(
      createExpense(ctx, form({ receiptKey: `receipts/${SEED_IDS.business}/missing.jpg` })),
    ).rejects.toThrow("Upload the receipt again");
    expect(
      expenseSchema.safeParse({
        date: today,
        supplier: "X",
        category: "fabric",
        amountCents: "10",
        vatCents: "11",
      }).success,
    ).toBe(false);
    expect(
      expenseSchema.safeParse({
        date: today,
        supplier: "X",
        category: "fabric",
        amountCents: "10",
        billable: "on",
      }).success,
    ).toBe(false);
  });

  it("bills expenses onto the project's draft invoice at cost plus markup, and frees them when the line goes", async () => {
    const ctx = ownerContext();
    const { projectId, clientId } = await project();
    const fabric = await createExpense(ctx, form({ projectId, billable: "on", vatCents: "750" }));
    const transport = await createExpense(
      ctx,
      form({ projectId, billable: "on", supplier: "Bolt", category: "transport", amountCents: "4,000" }),
    );

    const invoiceId = await billExpenses(ctx, { expenseIds: [fabric, transport], markupBp: 1500 });
    const draft = (await getInvoice(ctx, invoiceId))!;
    expect(draft.invoice).toMatchObject({ status: "draft", clientId, projectId });
    const section = draft.content.sections.find((s) => s.title === "Expenses")!;
    expect(section.lines.map((l) => l.unitPriceCents).sort((x, y) => x - y)).toEqual(
      [rechargeCents(4_000_00, 1500), rechargeCents(10_000_00, 1500)].sort((x, y) => x - y),
    );
    const billed = await listExpenses(ctx, { projectId });
    expect(billed.expenses.every((e) => e.billed && e.billedInvoiceId === invoiceId)).toBe(true);
    expect((await listExpenses(ctx, { projectId, unbilled: true })).expenses).toHaveLength(0);

    // Billed expenses can't be billed twice, deleted, or have their amount changed.
    await expect(billExpenses(ctx, { expenseIds: [fabric], markupBp: 0 })).rejects.toThrow(
      "already on an invoice",
    );
    await expect(deleteExpense(ctx, fabric)).rejects.toThrow(ServiceError);
    await expect(
      updateExpense(ctx, fabric, form({ projectId, billable: "on", amountCents: "1" })),
    ).rejects.toThrow(ServiceError);

    // A second bill goes onto the same draft.
    const tools = await createExpense(
      ctx,
      form({ projectId, billable: "on", supplier: "Tools", category: "tools" }),
    );
    expect(await billExpenses(ctx, { expenseIds: [tools], markupBp: 0 })).toBe(invoiceId);

    // Removing the fabric line from the draft frees that expense only.
    const now = (await getInvoice(ctx, invoiceId))!;
    const fabricLine = (await listExpenses(ctx, { projectId })).expenses.find(
      (e) => e.id === fabric,
    )!.billedInvoiceLineId;
    await saveInvoiceDraft(
      ctx,
      invoiceId,
      saveInvoiceDraftSchema.parse({
        version: now.invoice.draftVersion,
        header: {
          title: null,
          clientId,
          siteId: null,
          poReference: null,
          termsDays: now.invoice.termsDays,
          dueDate: null,
        },
        content: {
          sections: now.content.sections.map((s) => ({
            ...s,
            lines: s.lines.filter((l) => l.id !== fabricLine),
          })),
        },
      }),
    );
    const unbilled = (await listExpenses(ctx, { projectId, unbilled: true })).expenses.map((e) => e.id);
    expect(unbilled).toEqual([fabric]);

    // Deleting the draft frees the rest.
    await deleteInvoiceDraft(ctx, invoiceId);
    expect((await listExpenses(ctx, { projectId, unbilled: true })).expenses).toHaveLength(3);
    await deleteExpense(ctx, fabric);
    expect((await listExpenses(ctx, { projectId })).expenses).toHaveLength(2);
  });

  it("won't mix projects or bill expenses that aren't billable", async () => {
    const ctx = ownerContext();
    const one = await project();
    const two = await project();
    const a = await createExpense(ctx, form({ projectId: one.projectId, billable: "on" }));
    const b = await createExpense(ctx, form({ projectId: two.projectId, billable: "on" }));
    const c = await createExpense(ctx, form({ projectId: one.projectId }));
    await expect(billExpenses(ctx, { expenseIds: [a, b], markupBp: 0 })).rejects.toThrow("one project");
    await expect(billExpenses(ctx, { expenseIds: [c], markupBp: 0 })).rejects.toThrow("billable");
  });
});

import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { quickCreateClient } from "~/features/clients/service";
import {
  awaitingFinalInvoice,
  createInvoice,
  createInvoiceFromQuote,
  deleteInvoiceDraft,
  deletePayment,
  getInvoice,
  invoiceShareUrl,
  listInvoices,
  listPayments,
  outstandingSummary,
  recordPayment,
  reviseInvoice,
  saveInvoiceDraft,
  sendInvoice,
  voidInvoice,
} from "~/features/invoices/service";
import { jobsFor, listJobs } from "~/features/jobs/service";
import { recordPaymentSchema, saveInvoiceDraftSchema } from "~/features/invoices/schema";
import { approveSchema, changeRequestSchema } from "~/features/portal/schema";
import {
  approveQuote,
  loadPortalInvoice,
  loadPortalQuote,
  PortalError,
  postClientMessage,
  raiseChangeRequest,
  recordInvoiceView,
} from "~/features/portal/service";
import { saveDraftSchema } from "~/features/quotes/schema";
import { createQuote, quoteShareUrl, saveDraft, sendQuote } from "~/features/quotes/service";
import { ServiceError } from "~/features/settings/service";
import { addDays, businessToday } from "~/lib/dates";
import { schema } from "~/server/db";
import { SEED_IDS } from "~/server/db/seed-sql";
import { ownerContext, seed, testEnv } from "./helpers";

beforeEach(seed);

const META = { ip: "203.0.113.9", userAgent: "Vitest" };
const TO = { to: "client@example.ng", cc: [], bcc: [] };

/** SPEC 10.2 fixture F1, sent and approved by the client: ₦121,950.56 with VAT. */
async function approvedF1() {
  const ctx = ownerContext();
  const clientId = await quickCreateClient(ctx, {
    displayName: `F1 Client ${crypto.randomUUID().slice(0, 6)}`,
    email: "client@example.ng",
    phone: null,
  });
  const quoteId = await createQuote(ctx);
  await saveDraft(
    ctx,
    quoteId,
    saveDraftSchema.parse({
      version: 1,
      header: {
        title: "Living room drapery",
        clientId,
        siteId: null,
        validUntil: addDays(businessToday(), 30),
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
  await sendQuote(ctx, quoteId, { version: 2, ...TO });
  const [q] = await ctx.db.select().from(schema.quote).where(eq(schema.quote.id, quoteId));
  const url = await quoteShareUrl(testEnv, quoteId, q!.shareTokenSalt!);
  const token = url.slice(url.lastIndexOf("/") + 1);
  const portal = (await loadPortalQuote(testEnv, token))!;
  await approveQuote(
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
  return { ctx, quoteId, clientId };
}

async function send(id: string) {
  const detail = (await getInvoice(ownerContext(), id))!;
  return sendInvoice(ownerContext(), id, { version: detail.invoice.draftVersion, ...TO });
}

function pay(fields: Record<string, string>) {
  return recordPaymentSchema.parse({ receivedOn: businessToday(), method: "bank", ...fields });
}

describe("F1–F3 through the services (SPEC 10.2, FR-INV-01)", () => {
  it("deposit (F2) and final (F3) invoices add up to the approved quote exactly", async () => {
    const { ctx, quoteId } = await approvedF1();

    const depositId = await createInvoiceFromQuote(ctx, quoteId, { kind: "deposit" });
    const deposit = (await getInvoice(ctx, depositId))!;
    expect(deposit.invoice.kind).toBe("deposit");
    expect(deposit.totals.computed.subtotalCents).toBe(5_672_119);
    expect(deposit.totals.computed.taxCents).toBe(425_409);
    expect(deposit.totals.computed.totalCents).toBe(6_097_528);
    expect(deposit.content.sections[0]!.lines.every((l) => l.locked)).toBe(true);

    const sent = await send(depositId);
    expect(sent.number).toMatch(/^INV-\d+$/);
    expect(sent.status).toBe("sent");

    const finalId = await createInvoiceFromQuote(ctx, quoteId, { kind: "final" });
    const final = (await getInvoice(ctx, finalId))!;
    expect(final.totals.computed.subtotalCents).toBe(5_672_119);
    expect(final.totals.computed.taxCents).toBe(425_409);
    expect(final.totals.computed.totalCents).toBe(6_097_528);
    expect(deposit.totals.computed.totalCents + final.totals.computed.totalCents).toBe(12_195_056);
    // The credit names the deposit invoice it reverses.
    expect(final.content.sections.at(-1)!.lines[0]!.description).toContain(sent.number);

    // Only one final invoice per quote.
    await expect(createInvoiceFromQuote(ctx, quoteId, { kind: "final" })).rejects.toThrow("already a final");
  });

  it("progress invoices bill a percent or an amount; quotes must be approved", async () => {
    const { ctx, quoteId } = await approvedF1();
    const thirty = (await getInvoice(
      ctx,
      await createInvoiceFromQuote(ctx, quoteId, {
        kind: "progress",
        portionType: "percent",
        portionValue: 3000,
      }),
    ))!;
    expect(thirty.totals.computed.subtotalCents).toBe(3_403_271);
    const fixed = (await getInvoice(
      ctx,
      await createInvoiceFromQuote(ctx, quoteId, {
        kind: "progress",
        portionType: "amount",
        portionValue: 1_000_000,
      }),
    ))!;
    expect(fixed.totals.computed.subtotalCents).toBe(1_000_000);

    const draftQuote = await createQuote(ctx);
    await expect(createInvoiceFromQuote(ctx, draftQuote, { kind: "full" })).rejects.toThrow(
      "approved quotes",
    );
  });

  it("a full conversion copies the approved lines as an editable standard invoice", async () => {
    const { ctx, quoteId } = await approvedF1();
    const invoice = (await getInvoice(ctx, await createInvoiceFromQuote(ctx, quoteId, { kind: "full" })))!;
    expect(invoice.invoice.kind).toBe("standard");
    expect(invoice.totals.computed.totalCents).toBe(12_195_056);
    expect(invoice.content.sections[0]!.lines.some((l) => l.locked)).toBe(false);
  });
});

describe("locked lines can't be forged or dropped", () => {
  it("keeps the server's copy of generated lines on autosave", async () => {
    const { ctx, quoteId } = await approvedF1();
    const id = await createInvoiceFromQuote(ctx, quoteId, { kind: "deposit" });
    const before = (await getInvoice(ctx, id))!;
    const locked = before.content.sections[0]!.lines[0]!;
    await saveInvoiceDraft(
      ctx,
      id,
      saveInvoiceDraftSchema.parse({
        version: before.invoice.draftVersion,
        header: {
          title: "Deposit",
          clientId: before.invoice.clientId,
          siteId: null,
          poReference: "PO-7",
          termsDays: 7,
          dueDate: null,
        },
        content: {
          sections: [
            {
              id: before.content.sections[0]!.id,
              title: "Deposit",
              lines: [
                // A tampered copy of the locked line, and a forged new "locked" credit.
                { ...locked, unitPriceCents: 1, locked: true },
                {
                  id: "forged",
                  description: "Credit",
                  qtyMilli: 1000,
                  unit: "",
                  unitPriceCents: -999_999,
                  taxRateIds: [],
                  locked: true,
                },
                {
                  id: "extra",
                  description: "Delivery",
                  qtyMilli: 1000,
                  unit: "trip",
                  unitPriceCents: 500_000,
                  taxRateIds: [],
                },
              ],
            },
          ],
        },
      }),
    );
    const after = (await getInvoice(ctx, id))!;
    expect(after.invoice.poReference).toBe("PO-7");
    const lines = after.content.sections[0]!.lines;
    expect(lines.find((l) => l.id === locked.id)?.unitPriceCents).toBe(locked.unitPriceCents);
    expect(lines.find((l) => l.id === "forged")).toBeUndefined();
    expect(after.totals.computed.totalCents).toBe(6_097_528 + 500_000);
  });
});

describe("payments (FR-PAY-01…06, SPEC 8.3)", () => {
  async function sentDeposit() {
    const { ctx, quoteId, clientId } = await approvedF1();
    const id = await createInvoiceFromQuote(ctx, quoteId, { kind: "deposit" });
    await send(id);
    return { ctx, id, clientId, quoteId };
  }

  it("partial, then WHT plus cash settles it; status and balance follow; a receipt is queued", async () => {
    const { ctx, id } = await sentDeposit();
    const first = await recordPayment(ctx, id, pay({ amountCents: "3000000", reference: "TRF-1" }));
    expect(first).toMatchObject({ status: "partially_paid", balanceCents: 3_097_528, receiptQueued: true });

    // The rest: 5% WHT on the pre-VAT share, cash for the remainder.
    const rest = await recordPayment(
      ctx,
      id,
      pay({
        amountCents: String(3_097_528 - 144_074),
        whtRateBp: "500",
        whtCents: "144074",
        whtReference: "WHT-22",
      }),
    );
    expect(rest).toMatchObject({ status: "paid", balanceCents: 0 });
    const detail = (await getInvoice(ctx, id))!;
    expect(detail.invoice.status).toBe("paid");
    expect(detail.payments.find((p) => p.whtCents > 0)).toMatchObject({
      whtRateBp: 500,
      whtReference: "WHT-22",
    });
    const receipts = await ctx.db
      .select()
      .from(schema.emailMessage)
      .where(and(eq(schema.emailMessage.entityId, id), eq(schema.emailMessage.template, "payment_receipt")));
    expect(receipts).toHaveLength(2);

    await expect(recordPayment(ctx, id, pay({ amountCents: "1" }))).rejects.toThrow("already paid");
  });

  it("moves the job through its steps as invoices go out and money comes in (owner request)", async () => {
    const { ctx, id, quoteId } = await sentDeposit();
    const step = async () => (await jobsFor(ctx)).find((j) => j.id === quoteId)!.stage;
    expect(await step()).toMatchObject({
      step: 4,
      group: "money",
      action: { kind: "record_payment", invoiceId: id },
    });
    await recordPayment(ctx, id, pay({ amountCents: "6097528" }));
    expect(await step()).toMatchObject({
      step: 5,
      group: "finish",
      actionLabel: "Job finished: final invoice",
    });
    const { jobs } = await listJobs(ctx, { filter: "needs", limit: 1000 });
    expect(jobs.some((j) => j.id === quoteId)).toBe(true);
  });

  it("lists a job as ready for its final invoice until one is made (owner request)", async () => {
    const { ctx, quoteId } = await sentDeposit();
    const ready = (await awaitingFinalInvoice(ctx)).find((j) => j.id === quoteId);
    expect(ready).toMatchObject({
      approvedTotalCents: 12_195_056,
      invoicedCents: 6_097_528,
      leftToInvoiceCents: 6_097_528,
      paidCents: 0,
    });
    const { invoices } = await listInvoices(ctx, { limit: 500 });
    expect(invoices.find((x) => x.kind === "deposit" && x.quoteNumber === ready?.number)).toMatchObject({
      depositBp: 5000,
    });
    await createInvoiceFromQuote(ctx, quoteId, { kind: "final" });
    expect((await awaitingFinalInvoice(ctx)).some((j) => j.id === quoteId)).toBe(false);
  });

  it("a settled deposit is not the job paid in full: the receipt and screens show what's left", async () => {
    const { ctx, id } = await sentDeposit();
    const result = await recordPayment(ctx, id, pay({ amountCents: "6097528" }));
    expect(result).toMatchObject({ status: "paid", balanceCents: 0, jobRemainingCents: 6_097_528 });
    expect((await getInvoice(ctx, id))!.job).toMatchObject({
      approvedTotalCents: 12_195_056,
      paidCents: 6_097_528,
      remainingCents: 6_097_528,
    });
  });

  it("refuses an overpayment unless it becomes client credit", async () => {
    const { ctx, id, clientId } = await sentDeposit();
    const error = await recordPayment(ctx, id, pay({ amountCents: "7000000" })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ field: "allowCredit" });

    const result = await recordPayment(ctx, id, pay({ amountCents: "7000000", allowCredit: "on" }));
    expect(result).toMatchObject({ status: "paid", creditCents: 902_472, balanceCents: 0 });
    const [balance] = await ctx.db
      .select()
      .from(schema.clientBalance)
      .where(eq(schema.clientBalance.clientId, clientId));
    expect(balance!.creditAvailableCents).toBe(902_472);
    expect(balance!.paidCents).toBe(6_097_528);
  });

  it("deleting a payment recomputes the status and drops its credit", async () => {
    const { ctx, id, clientId } = await sentDeposit();
    const { paymentId } = await recordPayment(ctx, id, pay({ amountCents: "7000000", allowCredit: "on" }));
    const result = await deletePayment(ctx, { paymentId, reason: "Bounced transfer" });
    expect(result.status).toBe("sent");
    const detail = (await getInvoice(ctx, id))!;
    expect(detail.balanceCents).toBe(6_097_528);
    const [balance] = await ctx.db
      .select()
      .from(schema.clientBalance)
      .where(eq(schema.clientBalance.clientId, clientId));
    expect(balance!.creditAvailableCents).toBe(0);
    const ledger = await listPayments(ctx);
    expect(ledger.payments.find((p) => p.id === paymentId)).toMatchObject({
      deleteReason: "Bounced transfer",
    });
    await expect(deletePayment(ctx, { paymentId, reason: "again" })).rejects.toThrow("no longer exists");
  });

  it("refuses future dates and drafts", async () => {
    const { ctx, id } = await sentDeposit();
    await expect(
      recordPayment(ctx, id, pay({ amountCents: "100", receivedOn: addDays(businessToday(), 1) })),
    ).rejects.toThrow("future");
    const draft = await createInvoice(ctx);
    await expect(recordPayment(ctx, draft, pay({ amountCents: "100" }))).rejects.toThrow("hasn't been sent");
  });
});

describe("revisions and void (FR-INV-06)", () => {
  it("an unpaid invoice is revised under the same number; the old link stops working", async () => {
    const { ctx, quoteId } = await approvedF1();
    const id = await createInvoiceFromQuote(ctx, quoteId, { kind: "full" });
    const first = await send(id);
    const [before] = await ctx.db.select().from(schema.invoice).where(eq(schema.invoice.id, id));
    const oldUrl = await invoiceShareUrl(testEnv, id, before!.shareTokenSalt!);

    await reviseInvoice(ctx, id);
    const revised = await send(id);
    expect(revised).toMatchObject({ number: first.number, revisionNo: 2 });
    const [after] = await ctx.db.select().from(schema.invoice).where(eq(schema.invoice.id, id));
    expect(await invoiceShareUrl(testEnv, id, after!.shareTokenSalt!)).not.toBe(oldUrl);
  });

  it("an invoice with payments can't be revised; void and reissue moves its payments", async () => {
    const { ctx, quoteId } = await approvedF1();
    const id = await createInvoiceFromQuote(ctx, quoteId, { kind: "full" });
    const sent = await send(id);
    await recordPayment(ctx, id, pay({ amountCents: "5000000" }));
    await expect(reviseInvoice(ctx, id)).rejects.toThrow("void and reissue");
    await expect(voidInvoice(ctx, id, { reason: "Wrong fabric", reissue: false })).rejects.toThrow(
      "reissued",
    );

    const reissueId = (await voidInvoice(ctx, id, { reason: "Wrong fabric", reissue: true }))!;
    const voided = (await getInvoice(ctx, id))!;
    expect(voided.invoice).toMatchObject({ status: "void", voidReason: "Wrong fabric", number: sent.number });
    const reissue = (await getInvoice(ctx, reissueId))!;
    expect(reissue.invoice.reissueOfId).toBe(id);
    expect(reissue.settledCents).toBe(5_000_000);
    await expect(deleteInvoiceDraft(ctx, reissueId)).rejects.toThrow("carries payments");

    const resent = await send(reissueId);
    expect(resent.number).not.toBe(sent.number);
    expect(resent.status).toBe("partially_paid");
    expect((await getInvoice(ctx, reissueId))!.balanceCents).toBe(12_195_056 - 5_000_000);
  });

  it("an unpaid invoice can simply be voided", async () => {
    const { ctx, quoteId } = await approvedF1();
    const id = await createInvoiceFromQuote(ctx, quoteId, { kind: "deposit" });
    await send(id);
    expect(await voidInvoice(ctx, id, { reason: "Sent by mistake", reissue: false })).toBeNull();
    expect((await getInvoice(ctx, id))!.invoice.status).toBe("void");
  });
});

describe("payer portal /i/:token (FR-INV-08)", () => {
  async function portalFor(id: string) {
    const [row] = await ownerContext().db.select().from(schema.invoice).where(eq(schema.invoice.id, id));
    const url = await invoiceShareUrl(testEnv, id, row!.shareTokenSalt!);
    return url.slice(url.lastIndexOf("/") + 1);
  }

  it("shows the balance, records a view, and a message moves an unpaid invoice to changes requested", async () => {
    const { ctx, quoteId } = await approvedF1();
    const id = await createInvoiceFromQuote(ctx, quoteId, { kind: "deposit" });
    await send(id);
    const token = await portalFor(id);
    const portal = (await loadPortalInvoice(testEnv, token))!;
    expect(portal.balanceCents).toBe(6_097_528);
    await recordInvoiceView(testEnv, portal, META);
    expect((await getInvoice(ctx, id))!.invoice.status).toBe("viewed");

    // A plain message doesn't change the status; a change request does (FR-MSG-02, 07).
    await postClientMessage(
      testEnv,
      "invoice",
      token,
      { intent: "message", revisionId: portal.revision.id, name: "Amaka", message: "Thanks!" },
      META,
    );
    expect((await getInvoice(ctx, id))!.invoice.status).toBe("viewed");
    await raiseChangeRequest(
      testEnv,
      "invoice",
      token,
      changeRequestSchema.parse({
        intent: "change_request",
        revisionId: portal.revision.id,
        name: "Amaka",
        lineRef: "document",
        kind: "question",
        note: "Can I pay in two parts?",
      }),
      META,
    );
    expect((await getInvoice(ctx, id))!.invoice.status).toBe("changes_requested");

    // A payment during an open request keeps it open (SPEC 5.13) and the balance follows.
    const result = await recordPayment(ctx, id, pay({ amountCents: "1000000" }));
    expect(result.status).toBe("changes_requested");
    expect((await loadPortalInvoice(testEnv, token))!.balanceCents).toBe(5_097_528);
  });

  it("refuses messages on a void invoice, and unknown or rotated tokens find nothing", async () => {
    const { ctx, quoteId } = await approvedF1();
    const id = await createInvoiceFromQuote(ctx, quoteId, { kind: "deposit" });
    await send(id);
    const token = await portalFor(id);
    const revisionId = (await loadPortalInvoice(testEnv, token))!.revision.id;
    await voidInvoice(ctx, id, { reason: "Duplicate", reissue: false });
    await expect(
      postClientMessage(
        testEnv,
        "invoice",
        token,
        { intent: "message", revisionId, name: "Ada", message: "Hi" },
        META,
      ),
    ).rejects.toBeInstanceOf(PortalError);
    expect(await loadPortalInvoice(testEnv, "B".repeat(43))).toBeNull();
  });
});

describe("numbering under load (FR-INV-02)", () => {
  it("100 parallel sends produce 100 unique consecutive numbers", async () => {
    const ctx = ownerContext();
    const clientId = await quickCreateClient(ctx, {
      displayName: "Bulk Client",
      email: "bulk@example.ng",
      phone: null,
    });
    const ids = await Promise.all(Array.from({ length: 100 }, () => createInvoice(ctx, { clientId })));
    await Promise.all(
      ids.map((id) =>
        saveInvoiceDraft(
          ctx,
          id,
          saveInvoiceDraftSchema.parse({
            version: 1,
            header: { title: null, clientId, siteId: null, poReference: null, termsDays: 14, dueDate: null },
            content: {
              sections: [
                {
                  id: "s",
                  title: "Work",
                  lines: [
                    {
                      id: "l",
                      description: "Fee",
                      qtyMilli: 1000,
                      unit: "each",
                      unitPriceCents: 1000,
                      taxRateIds: [],
                    },
                  ],
                },
              ],
            },
          }),
        ),
      ),
    );
    const [seq] = await ctx.db
      .select()
      .from(schema.sequence)
      .where(eq(schema.sequence.id, SEED_IDS.invoiceSeq));
    const start = seq!.nextValue;
    const results = await Promise.all(ids.map((id) => sendInvoice(ctx, id, { version: 2, ...TO })));
    const numbers = results.map((r) => Number(r.number.slice(4))).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 100 }, (_, i) => start + i));

    const list = await listInvoices(ctx, { filter: "outstanding", clientId });
    expect(list.counts.outstanding).toBe(100);
    const summary = await outstandingSummary(ctx);
    expect(summary.outstandingCents).toBeGreaterThanOrEqual(100 * 1000);
    // 300 writes in parallel: more than the default 5 s when the whole suite shares the machine.
  }, 30_000);
});

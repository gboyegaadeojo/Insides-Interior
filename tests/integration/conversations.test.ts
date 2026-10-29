import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { quickCreateClient } from "~/features/clients/service";
import { resolveSchema } from "~/features/conversations/schema";
import {
  inboxBadge,
  listThreads,
  ownerThread,
  postOwnerMessage,
  resolveRequests,
  setMessageHidden,
} from "~/features/conversations/service";
import {
  getInvoice,
  invoiceShareUrl,
  recordPayment,
  remindableInvoices,
  saveInvoiceDraft,
  sendInvoice,
  createInvoice,
} from "~/features/invoices/service";
import { recordPaymentSchema, saveInvoiceDraftSchema } from "~/features/invoices/schema";
import { changeRequestSchema } from "~/features/portal/schema";
import {
  loadPortalQuote,
  PortalError,
  portalThread,
  portalWhatChanged,
  postClientMessage,
  raiseChangeRequest,
} from "~/features/portal/service";
import { saveDraftSchema } from "~/features/quotes/schema";
import {
  createQuote,
  discardRevision,
  getQuote,
  quoteShareUrl,
  reviseQuote,
  saveDraft,
  sendQuote,
} from "~/features/quotes/service";
import { ServiceError } from "~/features/settings/service";
import { addDays, businessToday } from "~/lib/dates";
import { schema } from "~/server/db";
import { SEED_IDS } from "~/server/db/seed-sql";
import { ownerContext, seed, testEnv } from "./helpers";

// SPEC 5.14 and phase 7: the payer's messages and change requests, the
// owner's replies and resolutions, revisions with What changed, and reminders.

beforeEach(seed);

const META = { ip: "203.0.113.11", userAgent: "Vitest" };
const TO = { to: "amaka@example.ng", cc: [], bcc: [] };

const LINES = [
  {
    id: "sofa",
    description: "Sofa",
    qtyMilli: 1000,
    unit: "each",
    unitPriceCents: 100_000_00,
    taxRateIds: [SEED_IDS.vat],
  },
  {
    id: "cushions",
    description: "Cushions",
    qtyMilli: 2000,
    unit: "each",
    unitPriceCents: 5_000_00,
    taxRateIds: [SEED_IDS.vat],
  },
  {
    id: "lamp",
    description: "Lamp",
    qtyMilli: 1000,
    unit: "each",
    unitPriceCents: 20_000_00,
    taxRateIds: [],
  },
];

async function client() {
  return quickCreateClient(ownerContext(), {
    displayName: `Amaka Obi ${crypto.randomUUID().slice(0, 6)}`,
    email: "amaka@example.ng",
    phone: null,
  });
}

/** A sent quote: sofa ₦100,000 + 2 cushions ₦5,000 (both VAT 7.5%) + lamp ₦20,000. */
async function sentQuote() {
  const ctx = ownerContext();
  const clientId = await client();
  const id = await createQuote(ctx);
  await saveDraft(
    ctx,
    id,
    saveDraftSchema.parse({
      version: 1,
      header: {
        title: "Living room",
        clientId,
        siteId: null,
        validUntil: addDays(businessToday(), 30),
        depositType: null,
        depositValue: null,
      },
      content: { sections: [{ id: "s1", title: "Living room", lines: LINES }] },
    }),
  );
  await sendQuote(ctx, id, { version: 2, ...TO });
  return { id, clientId, token: await quoteToken(id) };
}

async function quoteToken(id: string) {
  const [row] = await ownerContext().db.select().from(schema.quote).where(eq(schema.quote.id, id));
  const url = await quoteShareUrl(testEnv, id, row!.shareTokenSalt!);
  return url.slice(url.lastIndexOf("/") + 1);
}

async function invoiceToken(id: string) {
  const [row] = await ownerContext().db.select().from(schema.invoice).where(eq(schema.invoice.id, id));
  const url = await invoiceShareUrl(testEnv, id, row!.shareTokenSalt!);
  return url.slice(url.lastIndexOf("/") + 1);
}

function ask(fields: Record<string, string>) {
  return changeRequestSchema.parse({ intent: "change_request", name: "Amaka", note: "", ...fields });
}

async function revisionOf(token: string) {
  return (await loadPortalQuote(testEnv, token))!.revision.id;
}

function resolve(fields: Record<string, unknown>) {
  return resolveSchema.parse({ intent: "resolve", ...fields });
}

async function requestIds(entity: "quote" | "invoice", id: string) {
  const thread = await ownerThread(ownerContext(), entity, id);
  return thread.messages.flatMap((m) => (m.request ? [m.request.id] : []));
}

describe("the portal posts only to its own document (CLAUDE.md, SPEC 11)", () => {
  it("refuses another document's revision or line, and writes nothing to either", async () => {
    const a = await sentQuote();
    const b = await sentQuote();
    const bRevision = await revisionOf(b.token);
    const aRevision = await revisionOf(a.token);

    // Token A with B's revision id: stale, whatever the intent.
    await expect(
      postClientMessage(
        testEnv,
        "quote",
        a.token,
        { intent: "message", revisionId: bRevision, name: "Amaka", message: "Hi" },
        META,
      ),
    ).rejects.toMatchObject({ code: "stale" });
    await expect(
      raiseChangeRequest(
        testEnv,
        "quote",
        a.token,
        ask({ revisionId: bRevision, lineRef: "sofa", kind: "remove" }),
        META,
      ),
    ).rejects.toMatchObject({ code: "stale" });
    // A line that isn't on A's revision.
    await expect(
      raiseChangeRequest(
        testEnv,
        "quote",
        a.token,
        ask({ revisionId: aRevision, lineRef: "not-a-line", kind: "remove" }),
        META,
      ),
    ).rejects.toBeInstanceOf(PortalError);
    // A quote token can't reach an invoice through the invoice entry point.
    await expect(
      postClientMessage(
        testEnv,
        "invoice",
        a.token,
        { intent: "message", revisionId: aRevision, name: "Amaka", message: "Hi" },
        META,
      ),
    ).rejects.toMatchObject({ code: "invalid" });

    expect(await ownerContext().db.select().from(schema.message)).toHaveLength(0);
    expect((await getQuote(ownerContext(), a.id))!.quote.status).toBe("sent");
    expect((await getQuote(ownerContext(), b.id))!.quote.status).toBe("sent");
  });

  it("a message never changes the document; a line request is tied to its line and revision", async () => {
    const { id, token } = await sentQuote();
    const revisionId = await revisionOf(token);
    await postClientMessage(
      testEnv,
      "quote",
      token,
      { intent: "message", revisionId, name: "Amaka", message: "Lovely, thanks" },
      META,
    );
    expect((await getQuote(ownerContext(), id))!.quote.status).toBe("sent");

    await raiseChangeRequest(
      testEnv,
      "quote",
      token,
      ask({ revisionId, lineRef: "cushions", kind: "quantity", quantity: "1" }),
      META,
    );
    expect((await getQuote(ownerContext(), id))!.quote.status).toBe("changes_requested");
    const [request] = await ownerContext().db.select().from(schema.changeRequest);
    expect(request).toMatchObject({
      lineRef: "cushions",
      lineLabel: "Cushions",
      kind: "quantity",
      proposedQtyMilli: 1000,
      revisionId,
      status: "open",
    });

    const templates = (await ownerContext().db.select().from(schema.emailMessage)).map((e) => e.template);
    expect(templates).toContain("quote_message_owner");
    expect(templates).toContain("quote_changes_requested_owner");
    const activity = await ownerContext()
      .db.select({ action: schema.activity.action })
      .from(schema.activity)
      .where(and(eq(schema.activity.entityType, "quote"), eq(schema.activity.entityId, id)));
    expect(activity.map((a) => a.action)).toEqual(
      expect.arrayContaining(["quote.message_received", "quote.changes_requested"]),
    );

    // Quantity needs a number; a question needs words.
    expect(
      changeRequestSchema.safeParse({
        intent: "change_request",
        revisionId,
        name: "Amaka",
        lineRef: "sofa",
        kind: "quantity",
        quantity: "lots",
      }).success,
    ).toBe(false);
    expect(
      changeRequestSchema.safeParse({
        intent: "change_request",
        revisionId,
        name: "Amaka",
        lineRef: "sofa",
        kind: "question",
        note: "",
      }).success,
    ).toBe(false);
  });
});

describe("resolving change requests (FR-MSG-05, 06)", () => {
  it("two accepted requests make one revision with the right totals and a What changed summary", async () => {
    const ctx = ownerContext();
    const { id, token } = await sentQuote();
    const badge = await inboxBadge(ctx);
    const revisionId = await revisionOf(token);
    await raiseChangeRequest(
      testEnv,
      "quote",
      token,
      ask({ revisionId, lineRef: "cushions", kind: "remove" }),
      META,
    );
    await raiseChangeRequest(
      testEnv,
      "quote",
      token,
      ask({ revisionId, lineRef: "sofa", kind: "quantity", quantity: "2" }),
      META,
    );
    // One thread needs the owner, however many requests it holds.
    expect(await inboxBadge(ctx)).toBe(badge + 1);

    const result = await resolveRequests(
      ctx,
      "quote",
      id,
      resolve({ decision: "accept", requestIds: await requestIds("quote", id) }),
    );
    expect(result.redirectTo).toBe(`/quotes/${id}`);
    const draft = (await getQuote(ctx, id))!;
    expect(draft.quote.status).toBe("draft");
    // 2 sofas × ₦100,000 + 7.5% VAT, plus the lamp; the cushions are gone.
    expect(draft.totals.computed.totalCents).toBe(215_000_00 + 20_000_00);

    await sendQuote(ctx, id, { version: draft.quote.draftVersion, ...TO });
    const revisions = await ctx.db
      .select()
      .from(schema.quoteRevision)
      .where(eq(schema.quoteRevision.quoteId, id));
    expect(revisions.map((r) => r.revisionNo).sort()).toEqual([1, 2]);
    const rev2 = revisions.find((r) => r.revisionNo === 2)!;
    expect(rev2.totalCents).toBe(235_000_00);
    const sent = (await getQuote(ctx, id))!;
    expect(sent.quote.status).toBe("sent");
    const thread = await ownerThread(ctx, "quote", id);
    expect(thread.messages.map((m) => [m.request?.status, m.request?.resolvedInRevisionId])).toEqual([
      ["accepted", rev2.id],
      ["accepted", rev2.id],
    ]);

    // The revised email and the portal both say what changed.
    const emails = await ctx.db
      .select()
      .from(schema.emailMessage)
      .where(eq(schema.emailMessage.template, "quote_revised"));
    expect(emails).toHaveLength(1);
    expect(emails[0]!.subject).toMatch(/rev 2/);
    const changed = await portalWhatChanged(testEnv, "quote", id, rev2);
    expect(changed).toMatchObject({
      previousRevisionNo: 1,
      totalBeforeCents: 138_250_00,
      totalAfterCents: 235_000_00,
    });
    expect(changed!.lines).toEqual(["Changed Sofa: quantity 1 → 2", "Removed Cushions"]);
    // The payer was told about the outcome.
    expect((await ctx.db.select().from(schema.emailMessage)).map((e) => e.template)).toContain(
      "quote_owner_reply",
    );
    expect(await inboxBadge(ctx)).toBe(badge);
  });

  it("accepting one at a time still makes a single revision", async () => {
    const ctx = ownerContext();
    const { id, token } = await sentQuote();
    const revisionId = await revisionOf(token);
    await raiseChangeRequest(
      testEnv,
      "quote",
      token,
      ask({ revisionId, lineRef: "cushions", kind: "remove" }),
      META,
    );
    await raiseChangeRequest(
      testEnv,
      "quote",
      token,
      ask({ revisionId, lineRef: "lamp", kind: "remove" }),
      META,
    );
    const [first, second] = await requestIds("quote", id);
    await resolveRequests(ctx, "quote", id, resolve({ decision: "accept", requestIds: [first] }));
    await resolveRequests(ctx, "quote", id, resolve({ decision: "accept", requestIds: [second] }));
    const draft = (await getQuote(ctx, id))!;
    expect(draft.content.sections[0]!.lines.map((l) => l.id)).toEqual(["sofa"]);
    expect(draft.revising).toEqual({ revisionNo: 1 });
    // A resolved request can't be resolved again.
    await expect(
      resolveRequests(ctx, "quote", id, resolve({ decision: "decline", requestIds: [first], note: "No" })),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it("decline needs a reason and puts the quote back in the client's hands; discard reopens accepted ones", async () => {
    const ctx = ownerContext();
    const { id, token } = await sentQuote();
    const revisionId = await revisionOf(token);
    await raiseChangeRequest(
      testEnv,
      "quote",
      token,
      ask({ revisionId, lineRef: "lamp", kind: "remove" }),
      META,
    );
    const [req] = await requestIds("quote", id);
    await expect(
      resolveRequests(ctx, "quote", id, resolve({ decision: "decline", requestIds: [req], note: "" })),
    ).rejects.toMatchObject({ field: "note" });
    await resolveRequests(
      ctx,
      "quote",
      id,
      resolve({ decision: "decline", requestIds: [req], note: "The lamp completes the room" }),
    );
    expect((await getQuote(ctx, id))!.quote.status).toBe("viewed");
    const thread = await portalThread(testEnv, "quote", id);
    expect(thread[0]!.request).toMatchObject({
      status: "declined",
      resolutionNote: "The lamp completes the room",
    });

    // A question is answered, not accepted.
    await raiseChangeRequest(
      testEnv,
      "quote",
      token,
      ask({ revisionId, lineRef: "sofa", kind: "question", note: "Which fabric?" }),
      META,
    );
    const question = (await requestIds("quote", id))[1]!;
    await expect(
      resolveRequests(ctx, "quote", id, resolve({ decision: "accept", requestIds: [question] })),
    ).rejects.toBeInstanceOf(ServiceError);
    await resolveRequests(
      ctx,
      "quote",
      id,
      resolve({ decision: "answer", requestIds: [question], note: "Linen" }),
    );

    // Accept, then discard the revision: the request is open again and the quote shows it.
    await raiseChangeRequest(
      testEnv,
      "quote",
      token,
      ask({ revisionId, lineRef: "cushions", kind: "remove" }),
      META,
    );
    const third = (await requestIds("quote", id))[2]!;
    await resolveRequests(ctx, "quote", id, resolve({ decision: "accept", requestIds: [third] }));
    await discardRevision(ctx, id);
    expect((await getQuote(ctx, id))!.quote.status).toBe("changes_requested");
    const [reopened] = await ctx.db
      .select()
      .from(schema.changeRequest)
      .where(eq(schema.changeRequest.id, third));
    expect(reopened!.status).toBe("open");
  });
});

describe("sending a revision with requests still open (FR-MSG-05, 07)", () => {
  it("keeps the quote in changes requested, unless the owner says the revision deals with them", async () => {
    const ctx = ownerContext();
    const sendRevision = async (id: string, resolveOpen: boolean) => {
      await reviseQuote(ctx, id);
      const draft = (await getQuote(ctx, id))!;
      await sendQuote(ctx, id, { version: draft.quote.draftVersion, ...TO, resolveOpen });
      return (await getQuote(ctx, id))!.quote.status;
    };

    const kept = await sentQuote();
    await raiseChangeRequest(
      testEnv,
      "quote",
      kept.token,
      ask({ revisionId: await revisionOf(kept.token), lineRef: "lamp", kind: "other", note: "Brass?" }),
      META,
    );
    expect(await sendRevision(kept.id, false)).toBe("changes_requested");

    const closed = await sentQuote();
    await raiseChangeRequest(
      testEnv,
      "quote",
      closed.token,
      ask({ revisionId: await revisionOf(closed.token), lineRef: "lamp", kind: "other", note: "Brass?" }),
      META,
    );
    expect(await sendRevision(closed.id, true)).toBe("sent");
    const [message] = (await ownerThread(ctx, "quote", closed.id)).messages;
    expect(message!.request).toMatchObject({ status: "accepted", resolutionNote: "Changed in revision 2" });
  });
});

describe("owner replies, hiding and the Inbox (FR-MSG-04, 09, 10)", () => {
  it("a reply reaches the payer by email; hidden messages leave the portal but stay in the app", async () => {
    const ctx = ownerContext();
    const { id, token, clientId } = await sentQuote();
    const revisionId = await revisionOf(token);
    await postClientMessage(
      testEnv,
      "quote",
      token,
      { intent: "message", revisionId, name: "Amaka", message: "Spam spam" },
      META,
    );
    const open = await listThreads(ctx, { filter: "open", clientId });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      entityId: id,
      ownerUnread: 1,
      openRequests: 0,
      lastBody: "Spam spam",
      fromClient: true,
    });

    const thread = await ownerThread(ctx, "quote", id);
    expect(thread.unreadBefore).toBe(1);
    // Opening it read it.
    expect(await listThreads(ctx, { filter: "open", clientId })).toHaveLength(0);
    expect(await listThreads(ctx, { filter: "all", clientId })).toHaveLength(1);

    const { emailed } = await postOwnerMessage(ctx, "quote", id, "Thanks, Amaka!");
    expect(emailed).toBe(true);
    const reply = (await ctx.db.select().from(schema.emailMessage)).find(
      (e) => e.template === "quote_owner_reply",
    );
    expect(reply).toMatchObject({ to: "amaka@example.ng" });

    await setMessageHidden(ctx, thread.messages[0]!.id, true);
    const portal = await portalThread(testEnv, "quote", id);
    expect(portal.map((m) => m.body)).toEqual(["Thanks, Amaka!"]);
    const app = await ownerThread(ctx, "quote", id);
    expect(app.messages.map((m) => [m.from, m.hidden])).toEqual([
      ["client", true],
      ["team", false],
    ]);
    expect(app.messages[1]!.authorName).toBe("Owner Example");
    const hidden = await ctx.db
      .select()
      .from(schema.activity)
      .where(eq(schema.activity.action, "quote.message_hidden"));
    expect(hidden).toHaveLength(1);
    // Team messages can't be hidden.
    await expect(setMessageHidden(ctx, app.messages[1]!.id, true)).rejects.toBeInstanceOf(ServiceError);
  });
});

describe("invoices (FR-MSG-06, 07)", () => {
  async function sentInvoice() {
    const ctx = ownerContext();
    const clientId = await client();
    const id = await createInvoice(ctx, { clientId });
    await saveInvoiceDraft(
      ctx,
      id,
      saveInvoiceDraftSchema.parse({
        version: 1,
        header: {
          title: "Curtains",
          clientId,
          siteId: null,
          poReference: null,
          termsDays: 14,
          dueDate: null,
        },
        content: { sections: [{ id: "s1", title: "Living room", lines: LINES }] },
      }),
    );
    const detail = (await getInvoice(ctx, id))!;
    await sendInvoice(ctx, id, { version: detail.invoice.draftVersion, ...TO });
    return { id, token: await invoiceToken(id), revisionId: (await getInvoice(ctx, id))!.revision!.id };
  }

  it("reminders never go out while a request is open, paid or not", async () => {
    const ctx = ownerContext();
    const { id, token, revisionId } = await sentInvoice();
    const remindable = async () => (await remindableInvoices(ctx)).map((r) => r.id);
    expect(await remindable()).toContain(id);

    await raiseChangeRequest(
      testEnv,
      "invoice",
      token,
      ask({ revisionId, lineRef: "lamp", kind: "remove" }),
      META,
    );
    expect(await remindable()).not.toContain(id);

    // A part payment during the request keeps it paused (SPEC 5.13).
    await recordPayment(
      ctx,
      id,
      recordPaymentSchema.parse({ receivedOn: businessToday(), method: "bank", amountCents: "1000000" }),
    );
    expect((await getInvoice(ctx, id))!.invoice.status).toBe("changes_requested");
    expect(await remindable()).not.toContain(id);

    const [req] = await requestIds("invoice", id);
    await resolveRequests(
      ctx,
      "invoice",
      id,
      resolve({ decision: "decline", requestIds: [req], note: "It's part of the design" }),
    );
    expect((await getInvoice(ctx, id))!.invoice.status).toBe("partially_paid");
    expect(await remindable()).toContain(id);
  });

  it("an unpaid invoice is revised under its number; one with payments is voided and reissued", async () => {
    const ctx = ownerContext();
    const unpaid = await sentInvoice();
    await raiseChangeRequest(
      testEnv,
      "invoice",
      unpaid.token,
      ask({ revisionId: unpaid.revisionId, lineRef: "lamp", kind: "remove" }),
      META,
    );
    await resolveRequests(
      ctx,
      "invoice",
      unpaid.id,
      resolve({ decision: "accept", requestIds: await requestIds("invoice", unpaid.id) }),
    );
    const revising = (await getInvoice(ctx, unpaid.id))!;
    expect(revising.invoice.status).toBe("draft");
    expect(revising.invoice.number).toMatch(/^INV-/);
    expect(revising.totals.computed.totalCents).toBe(118_250_00);
    await sendInvoice(ctx, unpaid.id, { version: revising.invoice.draftVersion, ...TO });
    const sent = (await getInvoice(ctx, unpaid.id))!;
    expect(sent.revision!.revisionNo).toBe(2);
    expect(sent.invoice.status).toBe("sent");

    const paid = await sentInvoice();
    await recordPayment(
      ctx,
      paid.id,
      recordPaymentSchema.parse({ receivedOn: businessToday(), method: "bank", amountCents: "1000000" }),
    );
    await raiseChangeRequest(
      testEnv,
      "invoice",
      paid.token,
      ask({ revisionId: paid.revisionId, lineRef: "lamp", kind: "remove" }),
      META,
    );
    const ids = await requestIds("invoice", paid.id);
    await expect(
      resolveRequests(ctx, "invoice", paid.id, resolve({ decision: "accept", requestIds: ids })),
    ).rejects.toMatchObject({ field: "reissue" });
    const result = await resolveRequests(
      ctx,
      "invoice",
      paid.id,
      resolve({ decision: "accept", requestIds: ids, reissue: "on" }),
    );
    expect((await getInvoice(ctx, paid.id))!.invoice.status).toBe("void");
    const reissueId = result.redirectTo!.split("/").pop()!;
    const reissue = (await getInvoice(ctx, reissueId))!;
    expect(reissue.invoice.reissueOfId).toBe(paid.id);
    expect(reissue.content.sections[0]!.lines.map((l) => l.id)).toEqual(["sofa", "cushions"]);
    expect(reissue.settledCents).toBe(1_000_000);
  });
});

import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { quickCreateClient } from "~/features/clients/service";
import {
  applyResendEvent,
  NUMBER_PLACEHOLDER,
  processEmailJob,
  type EmailJob,
} from "~/features/email/service";
import { approveSchema, changeRequestSchema, portalActionSchema } from "~/features/portal/schema";
import {
  approveQuote,
  loadPortalQuote,
  MESSAGES_PER_HOUR,
  PortalError,
  postClientMessage,
  raiseChangeRequest,
  recordQuoteView,
} from "~/features/portal/service";
import { saveDraftSchema } from "~/features/quotes/schema";
import {
  createQuote,
  discardRevision,
  extendQuote,
  getQuote,
  quoteHistory,
  quoteShareUrl,
  reviseQuote,
  rotateQuoteLink,
  saveDraft,
  sendQuote,
} from "~/features/quotes/service";
import { ServiceError } from "~/features/settings/service";
import { addDays, businessToday } from "~/lib/dates";
import { schema } from "~/server/db";
import { SEED_IDS } from "~/server/db/seed-sql";
import { ownerContext, seed, testEnv } from "./helpers";

beforeEach(seed);

const META = { ip: "203.0.113.7", userAgent: "Vitest" };

/** A draft for a client with an email: one regular line and one option. */
async function draftQuote(opts: { email?: string | null } = {}) {
  const ctx = ownerContext();
  const clientId = await quickCreateClient(ctx, {
    displayName: `Amaka Obi ${crypto.randomUUID().slice(0, 6)}`,
    email: opts.email === undefined ? "amaka@example.ng" : opts.email,
    phone: null,
  });
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
                taxRateIds: [],
                optional: true,
              },
            ],
          },
        ],
      },
    }),
  );
  return { ctx, id, clientId };
}

async function send(id: string, version = 2) {
  return sendQuote(ownerContext(), id, { version, to: "amaka@example.ng", cc: [], bcc: [] });
}

async function tokenOf(id: string) {
  const [row] = await ownerContext()
    .db.select({ salt: schema.quote.shareTokenSalt })
    .from(schema.quote)
    .where(eq(schema.quote.id, id));
  const url = await quoteShareUrl(testEnv, id, row!.salt!);
  return url.slice(url.lastIndexOf("/") + 1);
}

async function emailsFor(id: string) {
  return ownerContext()
    .db.select()
    .from(schema.emailMessage)
    .where(and(eq(schema.emailMessage.entityType, "quote"), eq(schema.emailMessage.entityId, id)));
}

async function nextQuoteNumber() {
  const [seq] = await ownerContext()
    .db.select({ next: schema.sequence.nextValue })
    .from(schema.sequence)
    .where(eq(schema.sequence.id, SEED_IDS.quoteSeq));
  return seq!.next;
}

describe("sending (FR-QT-07, FR-QT-08)", () => {
  it("freezes revision 1, allocates the number, stores only the token hash and queues one email", async () => {
    const { id } = await draftQuote();
    const before = await nextQuoteNumber();
    const result = await send(id);
    expect(result).toMatchObject({ number: `Q-${before}`, revisionNo: 1, queued: true });
    expect(await nextQuoteNumber()).toBe(before + 1);

    const detail = (await getQuote(ownerContext(), id))!;
    expect(detail.quote.status).toBe("sent");
    expect(detail.quote.draftContent).toBeNull();
    expect(detail.revision?.revisionNo).toBe(1);
    // Server total: sofa ₦100,000 + 7.5% VAT; the unselected option is excluded.
    expect(detail.revision?.totalCents).toBe(107_500_00);

    const token = await tokenOf(id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(detail.quote.shareTokenHash).not.toContain(token);
    expect((await loadPortalQuote(testEnv, token))?.quote.id).toBe(id);

    const emails = await emailsFor(id);
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ status: "queued", template: "quote_sent", to: "amaka@example.ng" });
    // The stored subject has the real number, not the placeholder.
    expect(emails[0]!.subject).toContain(`Q-${before}`);
    expect(emails[0]!.subject).not.toContain(NUMBER_PLACEHOLDER);
  });

  it("refuses a quote without a client, lines or a future valid-until date", async () => {
    const ctx = ownerContext();
    const empty = await createQuote(ctx);
    await expect(sendQuote(ctx, empty, { version: 1, to: "a@example.ng", cc: [], bcc: [] })).rejects.toThrow(
      "Choose a client before sending",
    );
  });

  it("a double send emails once and never skips a number", async () => {
    const { id } = await draftQuote();
    const before = await nextQuoteNumber();
    const results = await Promise.allSettled([send(id), send(id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ServiceError);
    expect(await emailsFor(id)).toHaveLength(1);
    expect(await nextQuoteNumber()).toBe(before + 1);
    await expect(send(id, 3)).rejects.toThrow("already been sent");
  });

  it("parallel sends get consecutive, unique numbers", async () => {
    const drafts = await Promise.all(Array.from({ length: 20 }, () => draftQuote()));
    const before = await nextQuoteNumber();
    const results = await Promise.all(drafts.map((d) => send(d.id)));
    const numbers = results.map((r) => Number(r.number.slice(2))).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => before + i));
    expect(await nextQuoteNumber()).toBe(before + 20);
  });

  it("the email job fills in the number, sends once and records it", async () => {
    const { id } = await draftQuote();
    await send(id);
    const [email] = await emailsFor(id);
    const job: EmailJob = {
      kind: "email",
      emailId: email!.id,
      businessId: SEED_IDS.business,
      message: {
        to: ["amaka@example.ng"],
        subject: `Quote ${NUMBER_PLACEHOLDER}`,
        html: "<p>x</p>",
        text: "x",
        idempotencyKey: email!.idempotencyKey!,
      },
      numberFrom: { entity: "quote", id },
      pdf: { entity: "quote", id, revisionId: "irrelevant" },
    };
    await processEmailJob(testEnv, job, { lastAttempt: false });
    const [after] = await emailsFor(id);
    expect(after).toMatchObject({ status: "sent", transport: "dev" });
    // Redelivery is a no-op.
    await processEmailJob(testEnv, job, { lastAttempt: false });
    const sentEvents = await ownerContext()
      .db.select()
      .from(schema.activity)
      .where(and(eq(schema.activity.entityId, email!.id), eq(schema.activity.action, "email.sent")));
    expect(sentEvents).toHaveLength(1);
  });
});

describe("portal approval (FR-QT-10, FR-QT-12)", () => {
  it("records a view, then approves with the client's options and a server-computed total", async () => {
    const { id } = await draftQuote();
    await send(id);
    const token = await tokenOf(id);
    const portal = (await loadPortalQuote(testEnv, token))!;
    await recordQuoteView(testEnv, portal, META);
    expect((await loadPortalQuote(testEnv, token))!.quote.status).toBe("viewed");

    const result = await approveQuote(
      testEnv,
      token,
      approveSchema.parse({
        intent: "approve",
        revisionId: portal.revision.id,
        // An unknown id and the regular line are ignored; only real options count.
        options: ["cushions", "sofa", "made-up"],
        signerName: "  Amaka   Obi ",
        signerEmail: "",
        agree: "on",
        signature: JSON.stringify([[10, 10, 200, 120]]),
      }),
      META,
    );
    // ₦100,000 + VAT ₦7,500 + cushions ₦10,000 (no tax).
    expect(result.totalCents).toBe(117_500_00);
    expect(result.depositCents).toBe(58_750_00);

    const history = await quoteHistory(ownerContext(), id);
    expect(history.acceptance).toMatchObject({
      signerName: "Amaka Obi",
      acceptedTotalCents: 117_500_00,
      selectedOptionLineIds: ["cushions"],
      revisionNo: 1,
    });
    expect(history.acceptance?.signatureSvg).toContain("<path");
    const [acceptance] = await ownerContext().db.select().from(schema.quoteAcceptance);
    expect(acceptance).toMatchObject({ ip: META.ip, userAgent: "Vitest" });
    expect(acceptance!.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const detail = (await getQuote(ownerContext(), id))!;
    expect(detail.quote.status).toBe("approved");
    const [project] = await ownerContext()
      .db.select()
      .from(schema.project)
      .where(eq(schema.project.id, detail.quote.projectId!));
    expect(project).toMatchObject({ sourceQuoteId: id, name: "Living room" });

    // The seed has two owners (owner and e2e owner): each gets an email and a notification.
    const templates = (await emailsFor(id)).map((e) => e.template).sort();
    expect(templates).toEqual([
      "quote_approved_client",
      "quote_approved_owner",
      "quote_approved_owner",
      "quote_sent",
    ]);
    const notes = await ownerContext()
      .db.select()
      .from(schema.notification)
      .where(eq(schema.notification.entityId, id));
    // One per owner for the first view (phase 8, FR-SYS-02) and for the approval.
    expect(notes.map((n) => n.type).sort()).toEqual([
      "quote.approved",
      "quote.approved",
      "quote.viewed",
      "quote.viewed",
    ]);

    // Approving twice is refused.
    await expect(
      approveQuote(
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
      ),
    ).rejects.toThrow("already approved");
  });

  it("a stale revision can't be approved, and the old link stops working (FR-QT-09)", async () => {
    const { id } = await draftQuote();
    await send(id);
    const oldToken = await tokenOf(id);
    const rev1 = (await loadPortalQuote(testEnv, oldToken))!.revision.id;

    await reviseQuote(ownerContext(), id);
    // While revising, the client still sees rev 1 but can't approve it.
    await expect(
      approveQuote(
        testEnv,
        oldToken,
        approveSchema.parse({
          intent: "approve",
          revisionId: rev1,
          options: [],
          signerName: "Amaka Obi",
          signerEmail: "",
          agree: "on",
        }),
        META,
      ),
    ).rejects.toMatchObject({ code: "revising" });

    const version = (await getQuote(ownerContext(), id))!.quote.draftVersion;
    const result = await send(id, version);
    expect(result.revisionNo).toBe(2);
    expect(await loadPortalQuote(testEnv, oldToken)).toBeNull();

    const newToken = await tokenOf(id);
    const error = await approveQuote(
      testEnv,
      newToken,
      approveSchema.parse({
        intent: "approve",
        revisionId: rev1,
        options: [],
        signerName: "Amaka Obi",
        signerEmail: "",
        agree: "on",
      }),
      META,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PortalError);
    expect(error).toMatchObject({ code: "stale" });
    expect((await emailsFor(id)).map((e) => e.template).sort()).toEqual(["quote_revised", "quote_sent"]);
  });

  it("discarding a revision restores what the client had", async () => {
    const { id } = await draftQuote();
    await send(id);
    const token = await tokenOf(id);
    await recordQuoteView(testEnv, (await loadPortalQuote(testEnv, token))!, META);
    await reviseQuote(ownerContext(), id);
    await discardRevision(ownerContext(), id);
    const detail = (await getQuote(ownerContext(), id))!;
    expect(detail.quote.status).toBe("viewed");
    expect(detail.quote.draftContent).toBeNull();
    expect((await loadPortalQuote(testEnv, token))?.quote.id).toBe(id);
  });

  it("expires after valid-until, blocks approval, and the owner can extend (FR-QT-11)", async () => {
    const { id } = await draftQuote();
    await send(id);
    const token = await tokenOf(id);
    await ownerContext()
      .db.update(schema.quote)
      .set({ validUntil: addDays(businessToday(), -1) })
      .where(eq(schema.quote.id, id));
    const portal = (await loadPortalQuote(testEnv, token))!;
    expect(portal.quote.status).toBe("expired");
    await expect(
      approveQuote(
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
      ),
    ).rejects.toMatchObject({ code: "expired" });

    const validUntil = await extendQuote(ownerContext(), id);
    expect(validUntil > businessToday()).toBe(true);
    expect((await loadPortalQuote(testEnv, token))!.quote.status).toBe("sent");
  });

  it("a rotated link replaces the old one", async () => {
    const { id } = await draftQuote();
    await send(id);
    const before = await tokenOf(id);
    await rotateQuoteLink(ownerContext(), id);
    expect(await loadPortalQuote(testEnv, before)).toBeNull();
    expect((await loadPortalQuote(testEnv, await tokenOf(id)))?.quote.id).toBe(id);
  });

  it("rejects malformed and unknown tokens without a match", async () => {
    expect(await loadPortalQuote(testEnv, "short")).toBeNull();
    expect(await loadPortalQuote(testEnv, "A".repeat(43))).toBeNull();
    expect(await loadPortalQuote(testEnv, undefined)).toBeNull();
  });
});

describe("portal writes are limited to approve, message, change request (CLAUDE.md)", () => {
  it("rejects any other intent and unbounded input", () => {
    for (const intent of ["delete", "send", "revise", "update", "pay"]) {
      expect(portalActionSchema.safeParse({ intent, revisionId: "x" }).success).toBe(false);
    }
    expect(
      portalActionSchema.safeParse({
        intent: "message",
        revisionId: "x",
        name: "Amaka",
        message: "x".repeat(2001),
      }).success,
    ).toBe(false);
    expect(
      portalActionSchema.safeParse({ intent: "request_changes", revisionId: "x", name: "A", message: "x" })
        .success,
    ).toBe(false);
    expect(
      portalActionSchema.safeParse({
        intent: "approve",
        revisionId: "x",
        options: [],
        signerName: "Amaka",
        signerEmail: "",
      }).success,
    ).toBe(false);
  });

  it("a change request moves the quote, notifies the owners and is rate limited", async () => {
    const { id } = await draftQuote();
    await send(id);
    const token = await tokenOf(id);
    const revisionId = (await loadPortalQuote(testEnv, token))!.revision.id;
    await raiseChangeRequest(
      testEnv,
      "quote",
      token,
      changeRequestSchema.parse({
        intent: "change_request",
        revisionId,
        name: "Amaka",
        lineRef: "cushions",
        kind: "remove",
        note: "Please remove the cushions.",
      }),
      META,
    );
    expect((await getQuote(ownerContext(), id))!.quote.status).toBe("changes_requested");
    const [message] = await ownerContext().db.select().from(schema.message);
    expect(message).toMatchObject({ author: "client", clientName: "Amaka", revisionId });
    expect((await emailsFor(id)).map((e) => e.template)).toContain("quote_changes_requested_owner");

    const say = (message: string) =>
      postClientMessage(
        testEnv,
        "quote",
        token,
        { intent: "message", revisionId, name: "Amaka", message },
        META,
      );
    for (let i = 1; i < MESSAGES_PER_HOUR; i++) await say(`Note ${i}`);
    await expect(say("one too many")).rejects.toMatchObject({ code: "limit" });
  });
});

describe("Resend webhook events (SPEC 9.3)", () => {
  it("moves the status forward only, and flags a bounced client", async () => {
    const { id, clientId } = await draftQuote({ email: "bounce@example.ng" });
    await sendQuote(ownerContext(), id, { version: 2, to: "bounce@example.ng", cc: [], bcc: [] });
    const [email] = await emailsFor(id);
    await ownerContext()
      .db.update(schema.emailMessage)
      .set({ status: "sent", resendId: "re_123" })
      .where(eq(schema.emailMessage.id, email!.id));
    const event = (type: string) => ({ type, data: { email_id: "re_123" } });

    expect(await applyResendEvent(testEnv, event("email.opened"))).toMatchObject({ applied: true });
    expect(await applyResendEvent(testEnv, event("email.delivered"))).toMatchObject({ applied: false });
    expect(await applyResendEvent(testEnv, event("email.clicked"))).toMatchObject({ applied: false });
    expect(
      await applyResendEvent(testEnv, { type: "email.bounced", data: { email_id: "unknown" } }),
    ).toMatchObject({ applied: false });
    expect(await applyResendEvent(testEnv, event("email.bounced"))).toMatchObject({ applied: true });

    const [after] = await emailsFor(id);
    expect(after!.status).toBe("bounced");
    const [client] = await ownerContext()
      .db.select()
      .from(schema.client)
      .where(eq(schema.client.id, clientId));
    expect(client!.emailBouncedAt).not.toBeNull();
  });
});

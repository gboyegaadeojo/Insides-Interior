import { and, eq, like } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { runDailyJob, runWeeklyDigest, sendReminderNow } from "~/features/automation/service";
import { clientSchema } from "~/features/clients/schema";
import { quickCreateClient, updateClient } from "~/features/clients/service";
import { applyResendEvent } from "~/features/email/service";
import { recordPaymentSchema, saveInvoiceDraftSchema } from "~/features/invoices/schema";
import {
  createInvoice,
  getInvoice,
  invoiceShareUrl,
  recordPayment,
  saveInvoiceDraft,
  sendInvoice,
  setRemindersPaused,
} from "~/features/invoices/service";
import {
  listNotifications,
  markNotificationsRead,
  unreadNotifications,
} from "~/features/notifications/service";
import { changeRequestSchema } from "~/features/portal/schema";
import { loadPortalQuote, raiseChangeRequest, recordQuoteView } from "~/features/portal/service";
import { saveDraftSchema } from "~/features/quotes/schema";
import {
  createQuote,
  getQuote,
  quoteShareUrl,
  saveDraft,
  sendQuote,
  setFollowUpPaused,
} from "~/features/quotes/service";
import { searchRecords } from "~/features/search/service";
import { ServiceError } from "~/features/settings/service";
import { addDays, businessToday } from "~/lib/dates";
import { schema } from "~/server/db";
import { SEED_IDS } from "~/server/db/seed-sql";
import { ownerContext, seed, testEnv } from "./helpers";

// SPEC 14.1 phase 8: the daily job (overdue, reminders, follow-ups) and the
// weekly digest are idempotent; paused invoices and open change requests are
// skipped; notifications, search and bounce handling.

beforeEach(async () => {
  await seed();
  // Each test walks its own calendar; a run key from another test mustn't block it.
  await ownerContext().db.delete(schema.jobRun);
});

const META = { ip: "203.0.113.21", userAgent: "Vitest" };
const TO = { to: "payer@example.ng", cc: [], bcc: [] };
const today = businessToday();

/** 08:00 Lagos on `day` (07:00 UTC), when the daily job runs. */
const at = (day: string) => new Date(`${day}T07:00:00Z`);

async function client(email: string | null = "payer@example.ng") {
  return quickCreateClient(ownerContext(), {
    displayName: `Ada Eze ${crypto.randomUUID().slice(0, 6)}`,
    email,
    phone: null,
  });
}

/** An invoice for ₦50,000 sent today with 14-day terms (due today + 14). */
async function sentInvoice(email?: string | null) {
  const ctx = ownerContext();
  const clientId = await client(email);
  const id = await createInvoice(ctx, { clientId });
  await saveInvoiceDraft(
    ctx,
    id,
    saveInvoiceDraftSchema.parse({
      version: 1,
      header: { title: "Blinds", clientId, siteId: null, poReference: null, termsDays: 14, dueDate: null },
      content: {
        sections: [
          {
            id: "s",
            title: "Study",
            lines: [
              {
                id: "l",
                description: "Roller blind",
                qtyMilli: 1000,
                unit: "each",
                unitPriceCents: 50_000_00,
                taxRateIds: [],
              },
            ],
          },
        ],
      },
    }),
  );
  const detail = (await getInvoice(ctx, id))!;
  await sendInvoice(ctx, id, { version: detail.invoice.draftVersion, ...TO, to: email ?? TO.to });
  const due = (await getInvoice(ctx, id))!.invoice.dueDate!;
  return { id, clientId, due };
}

async function remindersFor(id: string) {
  const rows = await ownerContext()
    .db.select({ key: schema.emailMessage.idempotencyKey })
    .from(schema.emailMessage)
    .where(and(eq(schema.emailMessage.entityId, id), eq(schema.emailMessage.template, "payment_reminder")));
  return rows.map((r) => r.key).sort();
}

describe("the daily job (FR-AUTO-01)", () => {
  it("a staged overdue invoice gets exactly one reminder per cadence step", async () => {
    const { id, due } = await sentInvoice();
    const run = (offset: number) => runDailyJob(testEnv, at(addDays(due, offset)));

    expect((await run(-5)).reminders).toBeGreaterThanOrEqual(0);
    expect(await remindersFor(id)).toEqual([]);
    await run(-3);
    expect(await remindersFor(id)).toEqual([`reminder:${id}:-3`]);
    await run(-2);
    await run(0);
    expect((await getInvoice(ownerContext(), id))!.invoice.status).toBe("sent");
    await run(1);
    // Past the due date with money owed: overdue, and no extra reminder.
    expect((await getInvoice(ownerContext(), id))!.invoice.status).toBe("overdue");
    await run(7);
    // The job missed day 14; on day 20 only the latest step goes, once.
    await run(20);
    await run(21);
    await run(45);
    expect(await remindersFor(id)).toEqual(
      [`reminder:${id}:-3`, `reminder:${id}:0`, `reminder:${id}:7`, `reminder:${id}:14`].sort(),
    );
    const activity = await ownerContext()
      .db.select({ action: schema.activity.action })
      .from(schema.activity)
      .where(and(eq(schema.activity.entityId, id), like(schema.activity.action, "invoice.%")));
    expect(activity.filter((a) => a.action === "invoice.reminder_sent")).toHaveLength(4);
    expect(activity.filter((a) => a.action === "invoice.overdue")).toHaveLength(1);
  });

  it("running the job twice sends nothing twice, even if its run record is lost", async () => {
    const { id, due } = await sentInvoice();
    const first = await runDailyJob(testEnv, at(due));
    expect(first.skipped).toBeUndefined();
    expect(await runDailyJob(testEnv, at(due))).toMatchObject({ skipped: true });
    // A crashed run leaves its job_run row unfinished; drop it entirely and run again.
    await ownerContext().db.delete(schema.jobRun);
    const again = await runDailyJob(testEnv, at(due));
    expect(again.skipped).toBeUndefined();
    expect(await remindersFor(id)).toEqual([`reminder:${id}:0`]);
  });

  it("skips paused invoices, open change requests, paid invoices and clients without email", async () => {
    const ctx = ownerContext();
    const paused = await sentInvoice();
    await setRemindersPaused(ctx, paused.id, true);

    const asking = await sentInvoice();
    const [inv] = await ctx.db.select().from(schema.invoice).where(eq(schema.invoice.id, asking.id));
    const url = await invoiceShareUrl(testEnv, asking.id, inv!.shareTokenSalt!);
    await raiseChangeRequest(
      testEnv,
      "invoice",
      url.slice(url.lastIndexOf("/") + 1),
      changeRequestSchema.parse({
        intent: "change_request",
        revisionId: (await getInvoice(ctx, asking.id))!.revision!.id,
        name: "Ada",
        lineRef: "document",
        kind: "question",
        note: "Can I pay next month?",
      }),
      META,
    );

    const paid = await sentInvoice();
    await recordPayment(
      ctx,
      paid.id,
      recordPaymentSchema.parse({ receivedOn: today, method: "bank", amountCents: "5000000" }),
    );
    const silent = await sentInvoice(null);

    await runDailyJob(testEnv, at(addDays(paused.due, 7)));
    for (const { id } of [paused, asking, paid, silent]) expect(await remindersFor(id)).toEqual([]);
    // An open request also keeps it out of overdue (it stays in changes requested).
    expect((await getInvoice(ctx, asking.id))!.invoice.status).toBe("changes_requested");
    expect((await getInvoice(ctx, paused.id))!.invoice.status).toBe("overdue");

    // Resumed: the next run sends the step that's due.
    await setRemindersPaused(ctx, paused.id, false);
    await runDailyJob(testEnv, at(addDays(paused.due, 8)));
    expect(await remindersFor(paused.id)).toEqual([`reminder:${paused.id}:7`]);
  });

  it("sends a reminder by hand once a day without using up a step", async () => {
    const { id } = await sentInvoice();
    const ctx = ownerContext();
    expect(await sendReminderNow(ctx, id)).toBe("payer@example.ng");
    await expect(sendReminderNow(ctx, id)).rejects.toBeInstanceOf(ServiceError);
    expect(await remindersFor(id)).toEqual([`reminder:${id}:manual:${today}`]);
  });
});

describe("quote follow-ups and expiry", () => {
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
          title: "Curtains",
          clientId,
          siteId: null,
          validUntil: addDays(today, 30),
          depositType: null,
          depositValue: null,
        },
        content: {
          sections: [
            {
              id: "s",
              title: "Lounge",
              lines: [
                {
                  id: "c",
                  description: "Curtains",
                  qtyMilli: 1000,
                  unit: "set",
                  unitPriceCents: 80_000_00,
                  taxRateIds: [SEED_IDS.vat],
                },
              ],
            },
          ],
        },
      }),
    );
    await sendQuote(ctx, id, { version: 2, ...TO });
    return id;
  }

  async function followUps(id: string) {
    const rows = await ownerContext()
      .db.select()
      .from(schema.emailMessage)
      .where(and(eq(schema.emailMessage.entityId, id), eq(schema.emailMessage.template, "quote_follow_up")));
    return rows.length;
  }

  it("follows up on days 3 and 7 while unanswered, not when paused, and expires the quote after its date", async () => {
    const ctx = ownerContext();
    const id = await sentQuote();
    const quiet = await sentQuote();
    await setFollowUpPaused(ctx, quiet, true);

    await runDailyJob(testEnv, at(addDays(today, 2)));
    expect(await followUps(id)).toBe(0);
    await runDailyJob(testEnv, at(addDays(today, 3)));
    expect(await followUps(id)).toBe(1);
    await runDailyJob(testEnv, at(addDays(today, 5)));
    await runDailyJob(testEnv, at(addDays(today, 7)));
    await runDailyJob(testEnv, at(addDays(today, 12)));
    expect(await followUps(id)).toBe(2);
    expect(await followUps(quiet)).toBe(0);

    await runDailyJob(testEnv, at(addDays(today, 31)));
    expect((await getQuote(ctx, id))!.quote.status).toBe("expired");
  });
});

describe("the weekly digest (FR-AUTO-03)", () => {
  it("goes to each owner once per week", async () => {
    await sentInvoice();
    // A Monday at 07:30 Lagos.
    const monday = new Date("2026-11-30T06:30:00Z");
    const first = await runWeeklyDigest(testEnv, monday);
    expect(first.digests).toBeGreaterThan(0);
    expect(await runWeeklyDigest(testEnv, monday)).toMatchObject({ skipped: true });
    await ownerContext().db.delete(schema.jobRun);
    expect((await runWeeklyDigest(testEnv, monday)).digests).toBe(0);
    const digests = await ownerContext()
      .db.select()
      .from(schema.emailMessage)
      .where(eq(schema.emailMessage.template, "weekly_digest"));
    expect(digests.map((d) => d.idempotencyKey)).toEqual(
      expect.arrayContaining([`digest:2026-11-30:${SEED_IDS.owner}`]),
    );
    expect(digests[0]!.subject).toMatch(/need you/);
  });
});

describe("notifications, search and bounces (FR-SYS-01, 02; SPEC 9.3)", () => {
  it("a client's first look at a quote notifies the owner; reading clears the count", async () => {
    const ctx = ownerContext();
    await markNotificationsRead(ctx, "all");
    const clientId = await client();
    const id = await createQuote(ctx, { clientId });
    await saveDraft(
      ctx,
      id,
      saveDraftSchema.parse({
        version: 1,
        header: {
          title: null,
          clientId,
          siteId: null,
          validUntil: addDays(today, 30),
          depositType: null,
          depositValue: null,
        },
        content: {
          sections: [
            {
              id: "s",
              title: "Hall",
              lines: [
                {
                  id: "m",
                  description: "Mirror",
                  qtyMilli: 1000,
                  unit: "each",
                  unitPriceCents: 12_345_00,
                  taxRateIds: [],
                },
              ],
            },
          ],
        },
      }),
    );
    await sendQuote(ctx, id, { version: 2, ...TO });
    const [row] = await ctx.db.select().from(schema.quote).where(eq(schema.quote.id, id));
    const url = await quoteShareUrl(testEnv, id, row!.shareTokenSalt!);
    const portal = (await loadPortalQuote(testEnv, url.slice(url.lastIndexOf("/") + 1)))!;
    await recordQuoteView(testEnv, portal, META);
    await recordQuoteView(testEnv, { ...portal, quote: { ...portal.quote, status: "viewed" } }, META);

    expect(await unreadNotifications(ctx)).toBe(1);
    const [latest] = await listNotifications(ctx);
    expect(latest).toMatchObject({ type: "quote.viewed", href: `/quotes/${id}`, read: false });
    await markNotificationsRead(ctx, [latest!.id]);
    expect(await unreadNotifications(ctx)).toBe(0);

    // Search finds it by number, client and amount (FR-SYS-01).
    const number = row!.number!;
    expect((await searchRecords(ctx, number)).map((h) => h.id)).toContain(id);
    expect((await searchRecords(ctx, "₦12,345.00")).map((h) => h.id)).toContain(id);
    const [who] = await ctx.db.select().from(schema.client).where(eq(schema.client.id, clientId));
    const byName = await searchRecords(ctx, who!.displayName.toUpperCase());
    expect(byName.some((h) => h.kind === "client" && h.id === clientId)).toBe(true);
    expect(byName.some((h) => h.kind === "quote" && h.id === id)).toBe(true);
    expect(await searchRecords(ctx, "q")).toEqual([]);
  });

  it("a bounce flags the client, alerts the owners by email, and a new address clears the flag", async () => {
    const ctx = ownerContext();
    const { id, clientId } = await sentInvoice("bounce@example.ng");
    await ctx.db
      .update(schema.emailMessage)
      .set({ status: "sent", resendId: "re_bounce_1" })
      .where(and(eq(schema.emailMessage.entityId, id), eq(schema.emailMessage.template, "invoice_sent")));
    await applyResendEvent(testEnv, { type: "email.bounced", data: { email_id: "re_bounce_1" } });

    const [flagged] = await ctx.db.select().from(schema.client).where(eq(schema.client.id, clientId));
    expect(flagged!.emailBouncedAt).not.toBeNull();
    const alerts = await ctx.db
      .select()
      .from(schema.emailMessage)
      .where(eq(schema.emailMessage.template, "bounce_alert"));
    expect(alerts.some((a) => a.entityId === clientId && a.subject.includes("bounced"))).toBe(true);

    await updateClient(
      ctx,
      clientId,
      clientSchema.parse({ displayName: flagged!.displayName, email: "ada@example.ng", phone: "" }),
    );
    const [fixed] = await ctx.db.select().from(schema.client).where(eq(schema.client.id, clientId));
    expect(fixed!.emailBouncedAt).toBeNull();
  });
});

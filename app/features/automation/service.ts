// Automation (SPEC 5.9, 9.3, FR-AUTO-01/03). The daily job runs at 08:00
// Africa/Lagos: it marks overdue invoices, expires quotes past their date, and
// queues payment reminders and quote follow-ups per the cadence in Settings.
// The weekly digest goes to every owner on Monday at 07:30.
//
// Running a job twice sends nothing twice: a `job_run` row per run key claims
// the run, and every email carries an idempotency key per document and step
// (unique on email_message), so even an overlapping run can't double-send.

import { and, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { backupStale, newestBackup } from "~/domain/backups";
import { daysPastDue, dueStep, dueWording } from "~/domain/reminders";
import { formatCents } from "~/domain/money";
import { emailedOwners, emailInsert, enqueue, type EmailJob } from "~/features/email/service";
import { getInvoice, invoiceShareUrl, remindableInvoices } from "~/features/invoices/service";
import { quoteShareUrl } from "~/features/quotes/service";
import { loadEmailBrand } from "~/features/settings/doc-business";
import { ServiceError } from "~/features/settings/service";
import { addDays, businessToday, formatDate } from "~/lib/dates";
import { newId } from "~/lib/ids";
import { EMAIL_TEMPLATE_DEFAULTS } from "~/lib/merge-fields";
import { activityInsert } from "~/server/audit";
import { type Db, getDb, schema } from "~/server/db";
import type { EmailTemplateOverride } from "~/server/db/schema";
import { paymentReminderEmail, quoteFollowUpEmail, weeklyDigestEmail } from "~/server/email/templates";
import type { RequestContext } from "~/server/session";

type Batch = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];
type Brand = Awaited<ReturnType<typeof loadEmailBrand>>;

/** A run that started this long ago without finishing is taken over by the next attempt. */
const STALE_RUN_MS = 15 * 60 * 1000;

/** Claims a run; null if it already finished or is in progress elsewhere. */
async function claimRun(db: Db, job: string, runKey: string): Promise<string | null> {
  const id = newId("job");
  const inserted = await db
    .insert(schema.jobRun)
    .values({ id, job, runKey })
    .onConflictDoNothing()
    .returning({ id: schema.jobRun.id });
  if (inserted.length > 0) return id;
  const [existing] = await db
    .select()
    .from(schema.jobRun)
    .where(and(eq(schema.jobRun.job, job), eq(schema.jobRun.runKey, runKey)));
  if (!existing || existing.finishedAt) return null;
  if (Date.now() - Date.parse(existing.startedAt) < STALE_RUN_MS) return null;
  const taken = await db
    .update(schema.jobRun)
    .set({ startedAt: new Date().toISOString() })
    .where(and(eq(schema.jobRun.id, existing.id), eq(schema.jobRun.startedAt, existing.startedAt)))
    .returning({ id: schema.jobRun.id });
  return taken[0]?.id ?? null;
}

async function finishRun(db: Db, id: string, result: Record<string, unknown>) {
  await db
    .update(schema.jobRun)
    .set({ finishedAt: new Date().toISOString(), result })
    .where(eq(schema.jobRun.id, id));
}

function isDuplicate(error: unknown) {
  return /UNIQUE constraint failed/i.test(String(error instanceof Error ? error.message : error));
}

/** Sends a document email in its own batch; a step already sent (same key) is skipped. */
async function sendOnce(db: Db, statements: Batch): Promise<boolean> {
  try {
    await db.batch(statements);
    return true;
  } catch (error) {
    if (isDuplicate(error)) return false;
    throw error;
  }
}

/**
 * A status change with its activity, all or nothing: the guard after the
 * conditional UPDATE fails the batch (NOT NULL) when someone else moved the
 * document first (docs/decisions.md, phase 5).
 */
async function guarded(db: Db, statements: Batch): Promise<boolean> {
  try {
    await db.batch(statements);
    return true;
  } catch (error) {
    if (/NOT NULL constraint failed/i.test(String(error instanceof Error ? error.message : error)))
      return false;
    throw error;
  }
}

async function enqueueAll(env: Env, jobs: EmailJob[]) {
  // Queues take at most 100 messages per batch.
  for (let i = 0; i < jobs.length; i += 100) await enqueue(env, jobs.slice(i, i + 100));
}

function systemActivity(
  db: Db,
  businessId: string,
  entityType: string,
  entityId: string,
  action: string,
  data?: object,
) {
  return activityInsert(db, {
    businessId,
    actor: { type: "system" },
    entityType,
    entityId,
    action,
    data: data as Record<string, unknown> | undefined,
  });
}

interface ReminderTarget {
  id: string;
  businessId: string;
  number: string;
  clientName: string;
  clientEmail: string;
  dueDate: string;
  balanceCents: number;
}

function reminderMessage(
  brand: Brand,
  wording: EmailTemplateOverride | undefined,
  target: ReminderTarget,
  today: string,
  url: string,
  key: string,
) {
  const days = daysPastDue(target.dueDate, today);
  const defaults = EMAIL_TEMPLATE_DEFAULTS.payment_reminder!;
  return {
    ...paymentReminderEmail(brand, {
      clientName: target.clientName,
      number: target.number,
      due: formatCents(target.balanceCents),
      dueDate: formatDate(target.dueDate),
      standing: dueWording(days),
      overdue: days > 0,
      url,
      override: wording,
      defaults: { subject: defaults.subject, body: defaults.body },
    }),
    to: [target.clientEmail],
    replyTo: brand.replyTo,
    idempotencyKey: key,
  };
}

/** The step number in `<prefix>:<id>:<step>` keys; manual sends don't count as steps. */
function stepsFromKeys(keys: (string | null)[], prefix: string) {
  const sent = new Map<string, number[]>();
  for (const key of keys) {
    const match = key?.match(new RegExp(`^${prefix}:([^:]+):(-?\\d+)$`));
    if (!match) continue;
    sent.set(match[1]!, [...(sent.get(match[1]!) ?? []), Number(match[2])]);
  }
  return sent;
}

export interface DailyResult {
  skipped?: boolean;
  overdue: number;
  expired: number;
  reminders: number;
  followUps: number;
  /** Production only: the nightly backup is missing or old (SPEC 11.3). */
  backupStale?: boolean;
}

/**
 * FR-AUTO-01: the daily job. `now` is injectable so tests can walk through a
 * reminder cadence day by day.
 */
export async function runDailyJob(env: Env, now = new Date()): Promise<DailyResult> {
  const db = getDb(env);
  const today = businessToday(now);
  const result: DailyResult = { overdue: 0, expired: 0, reminders: 0, followUps: 0 };
  const run = await claimRun(db, "daily", `daily:${today}`);
  if (!run) return { ...result, skipped: true };

  const jobs: EmailJob[] = [];
  const businesses = await db.select({ id: schema.business.id }).from(schema.business);
  for (const { id: businessId } of businesses) {
    const [settings] = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.businessId, businessId));
    if (!settings) continue;
    const brand = await loadEmailBrand(db, env, businessId);

    // 1. Overdue: past the due date with money still owed (SPEC 8.3).
    const late = await db
      .select({ id: schema.invoice.id, status: schema.invoice.status, dueDate: schema.invoice.dueDate })
      .from(schema.invoice)
      .where(
        and(
          eq(schema.invoice.businessId, businessId),
          inArray(schema.invoice.status, ["sent", "viewed", "partially_paid"]),
          lt(schema.invoice.dueDate, today),
        ),
      );
    for (const inv of late) {
      const moved = await guarded(db, [
        db
          .update(schema.invoice)
          .set({ status: "overdue", updatedAt: now.toISOString() })
          .where(and(eq(schema.invoice.id, inv.id), eq(schema.invoice.status, inv.status))),
        db
          .update(schema.invoice)
          .set({
            draftVersion: sql`case when changes() = 1 then ${schema.invoice.draftVersion} else null end`,
          })
          .where(eq(schema.invoice.id, inv.id)),
        systemActivity(db, businessId, "invoice", inv.id, "invoice.overdue", { dueDate: inv.dueDate }),
      ]);
      if (moved) result.overdue++;
    }

    // 2. Quotes past their valid-until date (FR-QT-11), so follow-ups stop.
    const stale = await db
      .select({ id: schema.quote.id, status: schema.quote.status, validUntil: schema.quote.validUntil })
      .from(schema.quote)
      .where(
        and(
          eq(schema.quote.businessId, businessId),
          inArray(schema.quote.status, ["sent", "viewed"]),
          lt(schema.quote.validUntil, today),
        ),
      );
    for (const q of stale) {
      const moved = await guarded(db, [
        db
          .update(schema.quote)
          .set({ status: "expired", updatedAt: now.toISOString() })
          .where(and(eq(schema.quote.id, q.id), eq(schema.quote.status, q.status))),
        db
          .update(schema.quote)
          .set({ draftVersion: sql`case when changes() = 1 then ${schema.quote.draftVersion} else null end` })
          .where(eq(schema.quote.id, q.id)),
        systemActivity(db, businessId, "quote", q.id, "quote.expired", { validUntil: q.validUntil }),
      ]);
      if (moved) result.expired++;
    }

    // 3. Payment reminders: one per cadence step, never with an open request (FR-MSG-07).
    const cadence = settings.reminderCadence;
    const invoices = await remindableInvoices(db, businessId);
    const reminderKeys = invoices.length
      ? await db
          .select({ key: schema.emailMessage.idempotencyKey })
          .from(schema.emailMessage)
          .where(
            and(
              eq(schema.emailMessage.template, "payment_reminder"),
              inArray(
                schema.emailMessage.entityId,
                invoices.map((i) => i.id),
              ),
            ),
          )
      : [];
    const remindersSent = stepsFromKeys(
      reminderKeys.map((k) => k.key),
      "reminder",
    );
    for (const inv of invoices) {
      if (!inv.clientEmail || !inv.shareTokenSalt || !inv.dueDate || !inv.number) continue;
      const step = dueStep({
        base: inv.dueDate,
        today,
        steps: cadence.offsets,
        sent: remindersSent.get(inv.id) ?? [],
        notBefore: inv.issueDate,
        max: cadence.maxCount,
      });
      if (step === null) continue;
      const message = reminderMessage(
        brand,
        settings.emailTemplates.payment_reminder,
        {
          ...inv,
          businessId,
          number: inv.number,
          clientName: inv.clientName ?? "there",
          clientEmail: inv.clientEmail,
          dueDate: inv.dueDate,
        },
        today,
        await invoiceShareUrl(env, inv.id, inv.shareTokenSalt),
        `reminder:${inv.id}:${step}`,
      );
      const email = emailInsert(db, {
        businessId,
        entityType: "invoice",
        entityId: inv.id,
        template: "payment_reminder",
        message,
      });
      const sent = await sendOnce(db, [
        email.insert,
        systemActivity(db, businessId, "invoice", inv.id, "invoice.reminder_sent", {
          step,
          to: inv.clientEmail,
          balanceCents: inv.balanceCents,
        }),
      ]);
      if (!sent) continue;
      jobs.push({ kind: "email", emailId: email.id, businessId, message });
      result.reminders++;
    }

    // 4. Quote follow-ups while the client hasn't answered (SPEC 9.4).
    const quotes = await db
      .select({
        id: schema.quote.id,
        number: schema.quote.number,
        validUntil: schema.quote.validUntil,
        salt: schema.quote.shareTokenSalt,
        revisionId: schema.quoteRevision.id,
        sentAt: schema.quoteRevision.sentAt,
        totalCents: schema.quoteRevision.totalCents,
        clientName: schema.client.displayName,
        clientEmail: schema.client.email,
      })
      .from(schema.quote)
      .innerJoin(schema.quoteRevision, eq(schema.quoteRevision.id, schema.quote.currentRevisionId))
      .leftJoin(schema.client, eq(schema.client.id, schema.quote.clientId))
      .where(
        and(
          eq(schema.quote.businessId, businessId),
          inArray(schema.quote.status, ["sent", "viewed"]),
          eq(schema.quote.followUpPaused, false),
          gte(schema.quote.validUntil, today),
        ),
      );
    const followUpKeys = quotes.length
      ? await db
          .select({ key: schema.emailMessage.idempotencyKey })
          .from(schema.emailMessage)
          .where(
            and(
              eq(schema.emailMessage.template, "quote_follow_up"),
              inArray(
                schema.emailMessage.entityId,
                quotes.map((q) => q.id),
              ),
            ),
          )
      : [];
    // Keyed by revision: a revised quote starts its follow-ups again.
    const followUpsSent = stepsFromKeys(
      followUpKeys.map((k) => k.key),
      "follow_up",
    );
    const followDefaults = EMAIL_TEMPLATE_DEFAULTS.quote_follow_up!;
    for (const q of quotes) {
      if (!q.clientEmail || !q.salt || !q.sentAt || !q.number) continue;
      const step = dueStep({
        base: businessToday(new Date(q.sentAt)),
        today,
        steps: cadence.quoteFollowUpDays,
        sent: followUpsSent.get(q.revisionId) ?? [],
      });
      if (step === null) continue;
      const message = {
        ...quoteFollowUpEmail(brand, {
          clientName: q.clientName ?? "there",
          number: q.number,
          total: formatCents(q.totalCents),
          validUntil: q.validUntil ? formatDate(q.validUntil) : undefined,
          url: await quoteShareUrl(env, q.id, q.salt),
          override: settings.emailTemplates.quote_follow_up,
          defaults: { subject: followDefaults.subject, body: followDefaults.body },
        }),
        to: [q.clientEmail],
        replyTo: brand.replyTo,
        idempotencyKey: `follow_up:${q.revisionId}:${step}`,
      };
      const email = emailInsert(db, {
        businessId,
        entityType: "quote",
        entityId: q.id,
        template: "quote_follow_up",
        message,
      });
      const sent = await sendOnce(db, [
        email.insert,
        systemActivity(db, businessId, "quote", q.id, "quote.follow_up_sent", { step, to: q.clientEmail }),
      ]);
      if (!sent) continue;
      jobs.push({ kind: "email", emailId: email.id, businessId, message });
      result.followUps++;
    }
  }

  if (env.APP_ENV === "production") result.backupStale = await checkBackups(env, today);

  await enqueueAll(env, jobs);
  // Safety net: anything not yet pushed or emailed goes now (owner request).
  await enqueue(env, [{ kind: "notify" }]);
  await finishRun(db, run, { ...result });
  return result;
}

/**
 * SPEC 11.3: the nightly export (GitHub Actions, docs/runbook.md) runs outside
 * the Worker. Owners aren't told when it stops (owner request 2026-10-31: the
 * developer looks after backups, and GitHub emails them when the job fails);
 * the daily run records it in the automation log and the Worker logs.
 */
export async function checkBackups(env: Env, today: string) {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.BACKUPS.list({ prefix: "daily/", cursor });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const newest = newestBackup(keys);
  if (!backupStale(newest, today)) return false;
  console.warn(newest ? `Backups have stopped: the newest is from ${newest}` : "No database backup yet");
  return true;
}

/**
 * The owner sends a reminder now (SPEC 6.8 document detail, "Send reminder").
 * One a day per invoice; it doesn't use up a cadence step.
 */
export async function sendReminderNow(ctx: RequestContext, invoiceId: string) {
  const detail = await getInvoice(ctx, invoiceId);
  if (!detail) throw new ServiceError("This invoice no longer exists");
  const { invoice, client } = detail;
  if (!["sent", "viewed", "partially_paid", "overdue", "changes_requested"].includes(invoice.status))
    throw new ServiceError("Only an outstanding invoice can be reminded");
  if (detail.balanceCents <= 0) throw new ServiceError("Nothing is due on this invoice");
  if (!client?.email) throw new ServiceError("Add the client's email address first");
  if (!invoice.shareTokenSalt || !invoice.number || !invoice.dueDate)
    throw new ServiceError("This invoice hasn't been sent yet");
  const today = businessToday();
  const [settings] = await ctx.db
    .select({ emailTemplates: schema.settings.emailTemplates })
    .from(schema.settings)
    .where(eq(schema.settings.businessId, ctx.user.businessId));
  const brand = await loadEmailBrand(ctx.db, ctx.env, ctx.user.businessId);
  const message = reminderMessage(
    brand,
    settings?.emailTemplates.payment_reminder,
    {
      id: invoice.id,
      businessId: ctx.user.businessId,
      number: invoice.number,
      clientName: client.displayName,
      clientEmail: client.email,
      dueDate: invoice.dueDate,
      balanceCents: detail.balanceCents,
    },
    today,
    await invoiceShareUrl(ctx.env, invoice.id, invoice.shareTokenSalt),
    `reminder:${invoice.id}:manual:${today}`,
  );
  const email = emailInsert(ctx.db, {
    businessId: ctx.user.businessId,
    createdBy: ctx.user.id,
    entityType: "invoice",
    entityId: invoice.id,
    template: "payment_reminder",
    message,
  });
  const sent = await sendOnce(ctx.db, [
    email.insert,
    activityInsert(ctx.db, {
      businessId: ctx.user.businessId,
      actor: { type: "user", id: ctx.user.id },
      entityType: "invoice",
      entityId: invoice.id,
      action: "invoice.reminder_sent",
      data: { manual: true, to: client.email, balanceCents: detail.balanceCents },
    }),
  ]);
  if (!sent) throw new ServiceError("A reminder already went to the client today");
  await enqueue(ctx.env, [{ kind: "email", emailId: email.id, businessId: ctx.user.businessId, message }]);
  return client.email;
}

export interface WeeklyResult {
  skipped?: boolean;
  digests: number;
}

/** Monday of the week containing `today` (YYYY-MM-DD). */
function mondayOf(today: string) {
  const day = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, -((day + 6) % 7));
}

/** FR-AUTO-03: overdue, awaiting approval, open change requests, expiring this week. */
export async function runWeeklyDigest(env: Env, now = new Date()): Promise<WeeklyResult> {
  const db = getDb(env);
  const today = businessToday(now);
  const week = mondayOf(today);
  const run = await claimRun(db, "weekly", `weekly:${week}`);
  if (!run) return { skipped: true, digests: 0 };

  const jobs: EmailJob[] = [];
  let digests = 0;
  const i = schema.invoice;
  const q = schema.quote;
  const paid = sql<number>`coalesce((select sum(${schema.payment.amountCents} + ${schema.payment.whtCents}) from ${schema.payment} where ${schema.payment.invoiceId} = ${i.id} and ${schema.payment.deletedAt} is null), 0)`;
  const businesses = await db.select({ id: schema.business.id }).from(schema.business);
  for (const { id: businessId } of businesses) {
    const [[overdue], [awaiting], [requests], expiring] = await Promise.all([
      db
        .select({
          count: sql<number>`count(*)`,
          balance: sql<number>`coalesce(sum(${schema.invoiceRevision.totalCents} - ${paid}), 0)`,
        })
        .from(i)
        .innerJoin(schema.invoiceRevision, eq(schema.invoiceRevision.id, i.currentRevisionId))
        .where(and(eq(i.businessId, businessId), eq(i.status, "overdue"))),
      db
        .select({
          count: sql<number>`count(*)`,
          total: sql<number>`coalesce(sum(${schema.quoteRevision.totalCents}), 0)`,
        })
        .from(q)
        .innerJoin(schema.quoteRevision, eq(schema.quoteRevision.id, q.currentRevisionId))
        .where(and(eq(q.businessId, businessId), inArray(q.status, ["sent", "viewed"]))),
      db
        .select({ count: sql<number>`count(distinct ${schema.changeRequest.conversationId})` })
        .from(schema.changeRequest)
        .innerJoin(schema.conversation, eq(schema.conversation.id, schema.changeRequest.conversationId))
        .where(and(eq(schema.conversation.businessId, businessId), eq(schema.changeRequest.status, "open"))),
      db
        .select({ number: q.number })
        .from(q)
        .where(
          and(
            eq(q.businessId, businessId),
            inArray(q.status, ["sent", "viewed"]),
            gte(q.validUntil, today),
            lte(q.validUntil, addDays(week, 6)),
          ),
        ),
    ]);
    const facts = {
      overdue: { count: overdue?.count ?? 0, total: formatCents(overdue?.balance ?? 0) },
      awaiting: { count: awaiting?.count ?? 0, total: formatCents(awaiting?.total ?? 0) },
      openRequests: requests?.count ?? 0,
      expiring: { count: expiring.length, numbers: expiring.flatMap((e) => (e.number ? [e.number] : [])) },
    };
    // Nothing needs the owner: no email (a digest of zeros teaches people to ignore it).
    if (!facts.overdue.count && !facts.awaiting.count && !facts.openRequests && !facts.expiring.count)
      continue;
    const brand = await loadEmailBrand(db, env, businessId);
    for (const owner of await emailedOwners(db, businessId)) {
      const message = {
        ...weeklyDigestEmail(brand, {
          ownerName: owner.name,
          weekOf: formatDate(week),
          facts,
          url: new URL("/", env.APP_URL).toString(),
        }),
        to: [owner.email],
        idempotencyKey: `digest:${week}:${owner.id}`,
      };
      const email = emailInsert(db, {
        businessId,
        entityType: "business",
        entityId: businessId,
        template: "weekly_digest",
        message,
      });
      if (!(await sendOnce(db, [email.insert]))) continue;
      jobs.push({ kind: "email", emailId: email.id, businessId, message });
      digests++;
    }
  }
  await enqueueAll(env, jobs);
  await finishRun(db, run, { digests });
  return { digests };
}

/** Which job a cron expression runs (wrangler.jsonc triggers). */
export const CRON_JOBS: Record<string, "daily" | "weekly"> = {
  "0 7 * * *": "daily",
  "30 6 * * 1": "weekly",
};

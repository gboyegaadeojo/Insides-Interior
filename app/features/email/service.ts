// Outgoing email (SPEC 9.3). A service that sends mail writes an `email_message`
// row (status `queued`) in the same batch as the change it reports, then puts a
// job on the queue. The consumer attaches the PDF, calls Resend with the
// idempotency key and records the Resend id; the webhook moves the status on.

import { and, eq, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { quotePdf } from "~/features/quotes/pdf";
import { newId } from "~/lib/ids";
import { activityInsert } from "~/server/audit";
import { type Db, getDb, schema } from "~/server/db";
import { createEmailTransport } from "~/server/email";
import { PdfUnavailableError, pdfEnabled, toBase64 } from "~/server/pdf.server";

export interface OutgoingEmail {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** `<entity>:<revision>:<template>[:<recipient>]` (SPEC 9.3). */
  idempotencyKey: string;
}

export interface EmailJob {
  kind: "email";
  emailId: string;
  businessId: string;
  message: OutgoingEmail;
  /** Attach the PDF of this quote revision (skipped if superseded or in development). */
  pdf?: { entity: "quote"; id: string; revisionId: string };
  /** Replace NUMBER_PLACEHOLDER with this quote's number, allocated in the send batch. */
  numberFrom?: { entity: "quote"; id: string };
}

/**
 * A first send renders its email before the batch that allocates the number,
 * so the email carries this placeholder; the email_message subject and the
 * consumer fill in the real number (FR-QT-07: numbers come from the send).
 */
export const NUMBER_PLACEHOLDER = "[[number]]";

function fillNumber(message: OutgoingEmail, number: string): OutgoingEmail {
  const fill = (s: string) => s.replaceAll(NUMBER_PLACEHOLDER, number);
  return { ...message, subject: fill(message.subject), html: fill(message.html), text: fill(message.text) };
}

export type Job = EmailJob;

/**
 * The `email_message` row for a message, ready for the caller's batch. The
 * unique idempotency key makes a repeated send fail the whole batch instead of
 * emailing twice.
 */
export function emailInsert(
  db: Db,
  entry: {
    businessId: string;
    createdBy?: string | null;
    entityType: string;
    entityId: string;
    template: string;
    message: OutgoingEmail;
    /** Fill NUMBER_PLACEHOLDER in the stored subject from this quote, inside the batch. */
    numberFromQuoteId?: string;
  },
) {
  const id = newId("eml");
  const subject = entry.numberFromQuoteId
    ? sql<string>`replace(${entry.message.subject}, ${NUMBER_PLACEHOLDER}, (select ${schema.quote.number} from ${schema.quote} where ${schema.quote.id} = ${entry.numberFromQuoteId}))`
    : entry.message.subject;
  return {
    id,
    insert: db.insert(schema.emailMessage).values({
      id,
      businessId: entry.businessId,
      createdBy: entry.createdBy ?? null,
      entityType: entry.entityType,
      entityId: entry.entityId,
      template: entry.template,
      to: entry.message.to.join(", "),
      cc: entry.message.cc?.length ? entry.message.cc.join(", ") : null,
      subject,
      idempotencyKey: entry.message.idempotencyKey,
      status: "queued",
    }),
  };
}

/** Puts jobs on the queue. Returns false (and logs) if the queue refused them. */
export async function enqueue(env: Pick<Env, "JOBS">, jobs: Job[]): Promise<boolean> {
  if (jobs.length === 0) return true;
  try {
    await env.JOBS.sendBatch(jobs.map((body) => ({ body })));
    return true;
  } catch (error) {
    console.error("enqueue failed", error instanceof Error ? error.message : error);
    return false;
  }
}

/** Active owners: they get approval and change-request notices (SPEC 5.6 FR-QT-12). */
export async function activeOwners(db: Db, businessId: string) {
  return db
    .select({ id: schema.user.id, email: schema.user.email, name: schema.user.name })
    .from(schema.user)
    .where(
      and(
        eq(schema.user.businessId, businessId),
        eq(schema.user.role, "owner"),
        isNull(schema.user.disabledAt),
      ),
    );
}

/**
 * Queue consumer for one email job. Already-sent rows are skipped, so a
 * redelivered job never sends twice; Resend's idempotency key covers a crash
 * between the send and the status update. Throws to ask the queue to retry.
 */
export async function processEmailJob(env: Env, job: EmailJob, opts: { lastAttempt: boolean }) {
  const db = getDb(env);
  const [row] = await db
    .select({ status: schema.emailMessage.status })
    .from(schema.emailMessage)
    .where(eq(schema.emailMessage.id, job.emailId));
  if (!row || row.status !== "queued") return;

  try {
    let message = job.message;
    if (job.numberFrom) {
      const [quote] = await db
        .select({ number: schema.quote.number })
        .from(schema.quote)
        .where(eq(schema.quote.id, job.numberFrom.id));
      if (!quote?.number) throw new Error("The quote has no number yet");
      message = fillNumber(message, quote.number);
    }
    const attachments = [];
    if (job.pdf && pdfEnabled(env)) {
      const pdf = await quotePdf(env, job.pdf.id, { revisionId: job.pdf.revisionId });
      if (pdf) attachments.push({ filename: pdf.filename, content: toBase64(pdf.bytes) });
    }
    const result = await createEmailTransport(env).send({ ...message, attachments });
    await db.batch([
      db
        .update(schema.emailMessage)
        .set({
          status: "sent",
          resendId: result.id,
          transport: result.transport,
          error: null,
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(schema.emailMessage.id, job.emailId), eq(schema.emailMessage.status, "queued"))),
      activityInsert(db, {
        businessId: job.businessId,
        actor: { type: "system" },
        entityType: "email",
        entityId: job.emailId,
        action: "email.sent",
        data: { attachments: attachments.length },
      }),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = !(error instanceof PdfUnavailableError) || error.retryable;
    if (opts.lastAttempt || !retryable) {
      await db.batch([
        db
          .update(schema.emailMessage)
          .set({ status: "failed", error: message.slice(0, 500), updatedAt: new Date().toISOString() })
          .where(eq(schema.emailMessage.id, job.emailId)),
        activityInsert(db, {
          businessId: job.businessId,
          actor: { type: "system" },
          entityType: "email",
          entityId: job.emailId,
          action: "email.failed",
          data: { error: message.slice(0, 200) },
        }),
      ]);
      return;
    }
    throw error;
  }
}

// ---------- Resend webhook (SPEC 9.3 step 4) ----------

export const resendEventSchema = z.object({
  type: z.string(),
  created_at: z.string().optional(),
  data: z
    .object({
      email_id: z.string(),
      to: z.array(z.string()).optional(),
    })
    .passthrough(),
});

type EmailStatus = (typeof schema.emailMessage.status.enumValues)[number];

const EVENT_STATUS: Record<string, EmailStatus> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
};

// Statuses only move forward; a late "delivered" never hides an "opened".
const RANK: Record<EmailStatus, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  opened: 3,
  bounced: 4,
  complained: 4,
  failed: 4,
};

/** Applies one webhook event. Unknown emails and event types are ignored (200), never retried. */
export async function applyResendEvent(env: Env, event: z.output<typeof resendEventSchema>) {
  const status = EVENT_STATUS[event.type];
  if (!status) return { applied: false as const };
  const db = getDb(env);
  const [row] = await db
    .select()
    .from(schema.emailMessage)
    .where(eq(schema.emailMessage.resendId, event.data.email_id));
  if (!row) return { applied: false as const };
  if (RANK[status] < RANK[row.status] || status === row.status) return { applied: false as const };

  const now = new Date().toISOString();
  const statements: BatchItem<"sqlite">[] = [
    db.update(schema.emailMessage).set({ status, updatedAt: now }).where(eq(schema.emailMessage.id, row.id)),
    activityInsert(db, {
      businessId: row.businessId,
      actor: { type: "system" },
      entityType: row.entityType ?? "email",
      entityId: row.entityId ?? row.id,
      action: `email.${status}`,
      data: { to: row.to, subject: row.subject },
    }),
  ];

  // SPEC 9.3 step 5: flag a bounced address on the client and tell the owners.
  if (status === "bounced" || status === "complained") {
    const addresses = row.to.split(",").map((a) => a.trim().toLowerCase());
    const clients = await db
      .select({ id: schema.client.id, email: schema.client.email })
      .from(schema.client)
      .where(eq(schema.client.businessId, row.businessId));
    for (const c of clients) {
      if (c.email && addresses.includes(c.email.toLowerCase())) {
        statements.push(
          db
            .update(schema.client)
            .set({ emailBouncedAt: now, updatedAt: now })
            .where(eq(schema.client.id, c.id)),
        );
      }
    }
    for (const owner of await activeOwners(db, row.businessId)) {
      statements.push(
        db.insert(schema.notification).values({
          id: newId("ntf"),
          userId: owner.id,
          type: `email.${status}`,
          entityType: row.entityType,
          entityId: row.entityId,
          title: `Email to ${row.to} ${status === "bounced" ? "bounced" : "was marked as spam"}`,
        }),
      );
    }
  }
  await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return { applied: true as const, status };
}

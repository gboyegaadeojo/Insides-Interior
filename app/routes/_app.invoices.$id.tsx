import {
  Ban,
  Banknote,
  BellOff,
  BellRing,
  ChevronLeft,
  FileDown,
  Lock,
  PencilLine,
  Send,
  Trash2,
  Undo2,
} from "lucide-react";
import * as React from "react";
import { data, Form, Link, redirect, useActionData, useNavigation, useRevalidator } from "react-router";
import { DocumentRenderer, type DocumentRendererProps } from "~/components/doc/document-renderer";
import { Paper } from "~/components/doc/paper";
import { RouteErrorBoundary } from "~/components/shell/route-error";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Celebration } from "~/components/ui/celebration";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { DateField, TextField, Textarea } from "~/components/ui/field";
import { SaveStatus } from "~/components/ui/save-status";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { StatusBadge } from "~/components/ui/status-badge";
import { toast } from "~/components/ui/toast";
import { computeContent } from "~/domain/document";
import { percentPaid } from "~/domain/invoice";
import { canInvoice } from "~/domain/lifecycle";
import { formatBp, formatCents } from "~/domain/money";
import { listTemplates } from "~/features/catalogue/service";
import { ClientCombobox } from "~/features/clients/ui/client-combobox";
import { formatAddress } from "~/features/clients/service";
import { ownerThread, threadPanelData } from "~/features/conversations/service";
import {
  ConversationButton,
  ConversationSheet,
  RevisionRequests,
} from "~/features/conversations/ui/conversation-sheet";
import { ThreadPanel } from "~/features/conversations/ui/thread-panel";
import { BuilderWorkspace } from "~/features/documents/ui/builder-workspace";
import { expensesOnInvoice } from "~/features/expenses/service";
import type { BuilderItem } from "~/features/documents/ui/catalogue-sheet";
import { ClientLinkCard, HistoryCard } from "~/features/documents/ui/history-card";
import { SendSheet } from "~/features/documents/ui/send-sheet";
import { SentDocumentLayout } from "~/features/documents/ui/sent-layout";
import {
  type Draft,
  type DraftAction,
  type InvoiceDraftHeader,
  useDraft,
} from "~/features/documents/ui/use-draft";
import { INVOICE_KIND_LABEL, PAYMENT_METHOD_LABEL, TERMS_OPTIONS } from "~/features/invoices/constants";
import { deletePaymentSchema, recordPaymentSchema, voidInvoiceSchema } from "~/features/invoices/schema";
import {
  deleteInvoiceDraft,
  deletePayment,
  discardInvoiceRevision,
  getInvoice,
  InvoiceConflictError,
  invoiceHistory,
  invoiceSendSetup,
  invoiceShareUrl,
  paymentInstructions,
  recordPayment,
  retryInvoiceEmail,
  reviseInvoice,
  rotateInvoiceLink,
  sendInvoice,
  setRemindersPaused,
  voidInvoice,
} from "~/features/invoices/service";
import { sendReminderNow } from "~/features/automation/service";
import { RecordPaymentSheet } from "~/features/invoices/ui/record-payment-sheet";
import { SiteSelect } from "~/features/projects/ui/site-select";
import { sendQuoteSchema } from "~/features/quotes/schema";
import { builderCatalogue } from "~/features/quotes/service";
import { loadDocBusiness } from "~/features/settings/doc-business";
import { activeTaxRates, ServiceError } from "~/features/settings/service";
import { relativeTime } from "~/lib/activity-label";
import { addDays, businessToday, formatDate } from "~/lib/dates";
import type { AppHandle } from "~/lib/route-handle";
import { useNotice } from "~/lib/use-notice";
import { signedFileUrl } from "~/server/files";
import { assertSameOrigin, requireUser } from "~/server/session";
import type { Route } from "./+types/_app.invoices.$id";

export const handle: AppHandle = { module: "invoices", title: "Invoice" };

export function meta({ data: d }: Route.MetaArgs) {
  return [{ title: `${d?.invoice.number ?? "Draft invoice"} · Insides Interior` }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const ctx = await requireUser(context.cloudflare.env, request);
  const detail = await getInvoice(ctx, params.id);
  if (!detail) throw new Response("Not found", { status: 404 });
  const isDraft = detail.invoice.status === "draft";
  const [business, items, templates, rates, history, setup, shareUrl, instructions, thread, fromExpenses] =
    await Promise.all([
      loadDocBusiness(ctx.db, ctx.user.businessId),
      isDraft ? builderCatalogue(ctx) : [],
      isDraft ? listTemplates(ctx) : [],
      isDraft ? activeTaxRates(ctx) : [],
      detail.invoice.number ? invoiceHistory(ctx, params.id) : null,
      isDraft ? invoiceSendSetup(ctx) : null,
      detail.invoice.shareTokenSalt
        ? invoiceShareUrl(ctx.env, params.id, detail.invoice.shareTokenSalt)
        : null,
      paymentInstructions(ctx),
      detail.invoice.number ? ownerThread(ctx, "invoice", params.id) : null,
      expensesOnInvoice(ctx, params.id),
    ]);
  const builderItems: BuilderItem[] = await Promise.all(
    items.map(async (i) => ({
      id: i.id,
      type: i.type,
      name: i.name,
      description: i.description,
      unit: i.unit,
      priceCents: i.priceCents,
      defaultTaxIds: i.defaultTaxIds,
      photoUrl: i.photoKey ? await signedFileUrl(ctx.env, i.photoKey) : null,
    })),
  );
  const { shareTokenHash: _hash, shareTokenSalt: _salt, draftContent: _draft, ...invoice } = detail.invoice;
  return {
    invoice,
    fromExpenses,
    content: detail.content,
    revisionNo: detail.revisionNo,
    revising: detail.revising,
    revision: detail.revision,
    quote: detail.quote,
    reissueOf: detail.reissueOf,
    payments: detail.payments.map((p) => ({
      id: p.id,
      amountCents: p.amountCents,
      whtCents: p.whtCents,
      whtRateBp: p.whtRateBp,
      whtReference: p.whtReference,
      method: p.method,
      reference: p.reference,
      receivedOn: p.receivedOn,
      note: p.note,
      deletedAt: p.deletedAt,
      deleteReason: p.deleteReason,
    })),
    settledCents: detail.settledCents,
    balanceCents: detail.balanceCents,
    history,
    sendSetup: setup,
    shareUrl,
    instructions,
    client: detail.client
      ? {
          id: detail.client.id,
          name: detail.client.displayName,
          company: detail.client.company,
          address: formatAddress(detail.client.billingAddress),
          email: detail.client.email,
          emailBounced: Boolean(detail.client.emailBouncedAt),
        }
      : null,
    site: detail.site
      ? { id: detail.site.id, label: detail.site.label, address: formatAddress(detail.site.address) }
      : null,
    business,
    items: builderItems,
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      lines: t.lines.map((l) => ({ itemId: l.itemId, qtyMilli: l.qtyMilli })),
    })),
    defaultTaxIds: rates.filter((r) => r.isDefault).map((r) => r.id),
    today: businessToday(),
    isOwner: ctx.user.role === "owner",
    thread: thread && threadPanelData(thread),
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const ctx = await requireUser(context.cloudflare.env, request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const done = (message: string, extra: { status?: string } = {}) =>
    data({ ok: true as const, intent, message, error: null, field: null, status: extra.status ?? null });
  const fail = (error: string, field: string | null, status = 400) =>
    data({ ok: false as const, intent, message: null, error, field, status: null }, { status });
  try {
    switch (intent) {
      case "delete":
        await deleteInvoiceDraft(ctx, params.id);
        return redirect("/invoices?status=draft");
      case "send": {
        const parsed = sendQuoteSchema.safeParse(Object.fromEntries(form));
        if (!parsed.success) {
          const issue = parsed.error.issues[0]!;
          return fail(issue.message, String(issue.path[0]));
        }
        const sent = await sendInvoice(ctx, params.id, parsed.data);
        return done(
          sent.queued
            ? `${sent.number}${sent.revisionNo > 1 ? ` (rev ${sent.revisionNo})` : ""} sent to ${parsed.data.to}`
            : `${sent.number} is sent; its email is waiting. Retry it from the history.`,
        );
      }
      case "record_payment": {
        const parsed = recordPaymentSchema.safeParse(Object.fromEntries(form));
        if (!parsed.success) {
          const issue = parsed.error.issues[0]!;
          return fail(issue.message, String(issue.path[0]));
        }
        const result = await recordPayment(ctx, params.id, parsed.data);
        return done(
          result.status === "paid"
            ? `Paid in full${result.creditCents ? `; ${formatCents(result.creditCents)} kept as client credit` : ""}`
            : `Payment recorded; ${formatCents(result.balanceCents)} still due`,
          { status: result.status },
        );
      }
      case "delete_payment": {
        if (ctx.user.role !== "owner")
          throw new Response("Only the owner can delete payments", { status: 403 });
        const parsed = deletePaymentSchema.safeParse(Object.fromEntries(form));
        if (!parsed.success) return fail(parsed.error.issues[0]!.message, "reason");
        await deletePayment(ctx, parsed.data);
        return done("Payment deleted; the balance is updated");
      }
      case "void": {
        const parsed = voidInvoiceSchema.safeParse(Object.fromEntries(form));
        if (!parsed.success) return fail(parsed.error.issues[0]!.message, "reason");
        const reissueId = await voidInvoice(ctx, params.id, parsed.data);
        return reissueId ? redirect(`/invoices/${reissueId}`) : done("Invoice voided");
      }
      case "revise":
        await reviseInvoice(ctx, params.id);
        return done("Editing a revision. The client sees the current one until you send it.");
      case "discard_revision":
        await discardInvoiceRevision(ctx, params.id);
        return done("Revision discarded");
      case "rotate_link":
        await rotateInvoiceLink(ctx, params.id);
        return done("New link made. The old link no longer works.");
      case "retry_email":
        await retryInvoiceEmail(ctx, params.id);
        return done("Email queued again");
      case "pause_reminders":
      case "resume_reminders":
        await setRemindersPaused(ctx, params.id, intent === "pause_reminders");
        return done(
          intent === "pause_reminders" ? "Automatic reminders paused" : "Automatic reminders back on",
        );
      case "send_reminder":
        return done(`Reminder sent to ${await sendReminderNow(ctx, params.id)}`);
    }
  } catch (error) {
    if (error instanceof InvoiceConflictError) {
      return fail("This invoice changed in another tab. Reload, check it, then send.", null, 409);
    }
    if (error instanceof ServiceError) return fail(error.message, error.field ?? null);
    throw error;
  }
  throw new Response("Unknown action", { status: 400 });
}

type LoaderData = Route.ComponentProps["loaderData"];

export default function InvoiceScreen({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  useNotice();
  const [celebrate, setCelebrate] = React.useState(false);
  const [seen, setSeen] = React.useState(actionData);
  // Paid in full: the stamp and confetti (DS-MOT-04). State derived from a new result.
  if (actionData !== seen) {
    setSeen(actionData);
    if (actionData?.ok && actionData.intent === "record_payment" && actionData.status === "paid")
      setCelebrate(true);
  }
  React.useEffect(() => {
    if (!actionData) return;
    const sheetIntents = ["send", "record_payment", "void", "delete_payment"];
    if (actionData.ok) toast(actionData.message, { tone: "success" });
    else if (!sheetIntents.includes(actionData.intent))
      toast(actionData.error ?? "That didn't work", { tone: "error" });
  }, [actionData]);
  return (
    <>
      {loaderData.invoice.status === "draft" ? (
        <InvoiceBuilder
          // Accepting a change request rewrites the draft on the server: start the editor afresh.
          key={`${loaderData.invoice.id}-${loaderData.revising?.revisionNo ?? 0}-${loaderData.thread?.acceptedPending ?? 0}`}
          data={loaderData}
        />
      ) : (
        <SentInvoice data={loaderData} />
      )}
      <Celebration show={celebrate} label="Paid" onDone={() => setCelebrate(false)} />
    </>
  );
}

function dueDateOf(header: InvoiceDraftHeader, today: string) {
  return header.termsDays !== null ? addDays(today, header.termsDays) : header.dueDate;
}

function invoiceDocProps(
  data: LoaderData,
  draft: Pick<Draft<InvoiceDraftHeader>, "header" | "sections" | "notes" | "terms" | "documentDiscount">,
  client: DocumentRendererProps["client"],
  site: DocumentRendererProps["site"],
): DocumentRendererProps {
  const sent = data.invoice.status !== "draft";
  return {
    kind: "invoice",
    number: data.invoice.number,
    revision: data.revisionNo,
    title: draft.header.title,
    issuedOn: data.invoice.issueDate ?? data.today,
    untilDate: sent ? data.invoice.dueDate : dueDateOf(draft.header, data.today),
    business: data.business,
    client,
    site,
    sections: draft.sections,
    taxRates: data.content.taxRates,
    totals: computeContent({
      sections: draft.sections,
      documentDiscount: draft.documentDiscount,
      taxRates: data.content.taxRates,
    }),
    notes: draft.notes,
    terms: draft.terms,
    reference: draft.header.poReference,
    paymentInstructions: data.instructions,
    settlement: sent ? { paidCents: data.settledCents, balanceCents: data.balanceCents } : null,
    stamp: data.invoice.status === "paid" ? "paid" : data.invoice.status === "void" ? "void" : null,
  };
}

function BackLink() {
  return (
    <Link
      to="/invoices"
      className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-control px-2 font-semibold text-indigo-ink"
    >
      <ChevronLeft className="size-5" aria-hidden />
      Invoices
    </Link>
  );
}

function headerOf(data: LoaderData): InvoiceDraftHeader {
  return {
    title: data.invoice.title,
    clientId: data.invoice.clientId,
    siteId: data.invoice.siteId,
    poReference: data.invoice.poReference,
    termsDays: data.invoice.termsDays,
    dueDate: data.invoice.dueDate,
  };
}

// ---------- Sent ----------

function SentInvoice({ data }: { data: LoaderData }) {
  const { header: _header, ...content } = data.content;
  const props = invoiceDocProps(data, { header: headerOf(data), ...content }, data.client, data.site);
  const status = data.invoice.status;
  const navigation = useNavigation();
  const actionData = useActionData<typeof action>();
  const busy = (intent: string) =>
    navigation.state !== "idle" && navigation.formData?.get("intent") === intent;
  const [paying, setPaying] = React.useState(false);
  const [voiding, setVoiding] = React.useState(false);
  const canPay = ["sent", "viewed", "changes_requested", "partially_paid", "overdue"].includes(status);
  const canRevise = canInvoice(status, "revise") && data.settledCents === 0;
  const total = data.revision?.totalCents ?? 0;

  // Close the payment sheet once the payment is recorded (derived during render).
  const [handled, setHandled] = React.useState(actionData);
  if (actionData !== handled) {
    setHandled(actionData);
    if (actionData?.ok && actionData.intent === "record_payment") setPaying(false);
    if (actionData?.ok && actionData.intent === "void") setVoiding(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <BackLink />
        <span className="font-display text-section">{data.invoice.number}</span>
        <StatusBadge
          status={status}
          revision={data.revisionNo ?? undefined}
          percentPaid={percentPaid(total, data.settledCents)}
        />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button asChild variant="ghost">
            <a href={`/invoices/${data.invoice.id}/pdf`} target="_blank" rel="noreferrer">
              <FileDown aria-hidden />
              PDF
            </a>
          </Button>
          {canInvoice(status, "void") && (
            <Button type="button" variant="ghost" onClick={() => setVoiding(true)}>
              <Ban aria-hidden />
              Void
            </Button>
          )}
          {canRevise && (
            <Form method="post">
              <input type="hidden" name="intent" value="revise" />
              <Button type="submit" variant="secondary" loading={busy("revise")}>
                <PencilLine aria-hidden />
                Revise
              </Button>
            </Form>
          )}
          {canPay && (
            <Button type="button" onClick={() => setPaying(true)}>
              <Banknote aria-hidden />
              Record payment
            </Button>
          )}
        </div>
      </div>

      {status === "void" && (
        <div role="status" className="rounded-card border border-border bg-surface-2 p-4">
          <p className="font-semibold">
            Void{data.invoice.voidedAt ? ` since ${relativeTime(data.invoice.voidedAt)}` : ""}
          </p>
          {data.invoice.voidReason && <p className="text-secondary">Reason: {data.invoice.voidReason}</p>}
        </div>
      )}

      <SentDocumentLayout
        document={
          <Paper className="mx-auto max-w-[816px]">
            <DocumentRenderer {...props} flaggedLines={data.thread?.openLines} />
          </Paper>
        }
        cards={
          <>
            <BalanceCard data={data} total={total} />
            <PaymentsCard data={data} />
          </>
        }
        thread={
          data.thread && (
            <ThreadPanel
              entity="invoice"
              entityId={data.invoice.id}
              thread={data.thread}
              clientName={data.client?.name ?? null}
              canReply
              canHide={data.isOwner}
              hasPayments={data.settledCents > 0}
              heading
            />
          )
        }
        threadCount={(data.thread?.openRequests ?? 0) + (data.thread?.unreadBefore ?? 0)}
        attention={!!data.thread && (data.thread.openRequests > 0 || data.thread.unreadBefore > 0)}
        moreCards={
          <>
            {data.shareUrl && status !== "void" && (
              <ClientLinkCard url={data.shareUrl} busy={busy("rotate_link")} noun="invoice" />
            )}
            {data.history && <HistoryCard history={data.history} retrying={busy("retry_email")} />}
          </>
        }
      />

      {canPay && data.invoice.number && (
        <RecordPaymentSheet
          key={data.balanceCents}
          open={paying}
          onOpenChange={setPaying}
          number={data.invoice.number}
          totalCents={total}
          taxCents={data.revision?.taxCents ?? 0}
          balanceCents={data.balanceCents}
          today={data.today}
          error={actionData && !actionData.ok && actionData.intent === "record_payment" ? actionData : null}
        />
      )}
      <VoidDialog
        open={voiding}
        onOpenChange={setVoiding}
        hasPayments={data.settledCents > 0}
        error={actionData && !actionData.ok && actionData.intent === "void" ? actionData.error : null}
      />
    </div>
  );
}

function BalanceCard({ data, total }: { data: LoaderData; total: number }) {
  const wht = data.payments.filter((p) => !p.deletedAt).reduce((s, p) => s + p.whtCents, 0);
  const overdue = data.invoice.status === "overdue";
  return (
    <Card>
      <h2 className="font-display text-title">Balance</h2>
      <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5">
        <dt className="text-secondary">Total</dt>
        <dd className="text-right tabular">{formatCents(total)}</dd>
        <dt className="text-secondary">Paid</dt>
        <dd className="text-right tabular">{formatCents(data.settledCents - wht)}</dd>
        {wht > 0 && (
          <>
            <dt className="text-secondary">Withholding tax</dt>
            <dd className="text-right tabular">{formatCents(wht)}</dd>
          </>
        )}
        <div className="col-span-2 my-1 border-t border-border" aria-hidden />
        <dt className="font-semibold">Balance due</dt>
        <dd className="text-right font-display text-title tabular" data-testid="invoice-balance">
          {formatCents(Math.max(0, data.balanceCents))}
        </dd>
      </dl>
      {data.invoice.dueDate && data.balanceCents > 0 && data.invoice.status !== "void" && (
        <p className={overdue ? "mt-2 font-semibold text-danger-ink" : "mt-2 text-label text-secondary"}>
          {overdue ? "Overdue since " : "Due "}
          {formatDate(data.invoice.dueDate)}
        </p>
      )}
      <RemindersRow data={data} />
      {(data.quote || data.reissueOf) && (
        <p className="mt-3 text-label text-secondary">
          {INVOICE_KIND_LABEL[data.invoice.kind]}
          {data.quote && (
            <>
              {" for "}
              <Link to={`/quotes/${data.quote.id}`} className="font-semibold text-primary underline">
                quote {data.quote.number}
              </Link>
            </>
          )}
          {data.reissueOf && (
            <>
              {"; reissues "}
              <Link to={`/invoices/${data.reissueOf.id}`} className="font-semibold text-primary underline">
                {data.reissueOf.number}
              </Link>
            </>
          )}
        </p>
      )}
    </Card>
  );
}

/**
 * FR-AUTO-02: automatic reminders on or paused for this invoice, and a reminder
 * sent now. Shown while something is owed.
 */
function RemindersRow({ data }: { data: LoaderData }) {
  const navigation = useNavigation();
  const busy = (intent: string) =>
    navigation.state !== "idle" && navigation.formData?.get("intent") === intent;
  const outstanding = ["sent", "viewed", "changes_requested", "partially_paid", "overdue"].includes(
    data.invoice.status,
  );
  if (!outstanding || data.balanceCents <= 0) return null;
  const paused = data.invoice.remindersPaused;
  const waiting = data.invoice.status === "changes_requested" || (data.thread?.openRequests ?? 0) > 0;
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4" data-testid="reminders">
      <div className="flex items-start gap-3">
        <span
          className={
            paused || waiting
              ? "mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-saffron-tint px-2 py-0.5 text-micro font-semibold text-saffron-ink"
              : "mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-sage-tint px-2 py-0.5 text-micro font-semibold text-sage-ink"
          }
        >
          {paused ? (
            <BellOff className="size-3.5" aria-hidden />
          ) : (
            <BellRing className="size-3.5" aria-hidden />
          )}
          {paused ? "Reminders paused" : waiting ? "Reminders waiting" : "Reminders on"}
        </span>
        <p className="text-label text-secondary">
          {paused
            ? "No automatic reminders go to the client until you resume them."
            : waiting
              ? "They resume once the client's change request is resolved."
              : "Sent at 8 a.m. on the days set in Settings → Reminders."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Form method="post">
          <input type="hidden" name="intent" value={paused ? "resume_reminders" : "pause_reminders"} />
          <Button
            type="submit"
            variant="secondary"
            loading={busy("pause_reminders") || busy("resume_reminders")}
          >
            {paused ? <BellRing aria-hidden /> : <BellOff aria-hidden />}
            {paused ? "Resume reminders" : "Pause reminders"}
          </Button>
        </Form>
        <Form method="post">
          <input type="hidden" name="intent" value="send_reminder" />
          <Button type="submit" variant="ghost" loading={busy("send_reminder")}>
            <Send aria-hidden />
            Send a reminder now
          </Button>
        </Form>
      </div>
    </div>
  );
}

function PaymentsCard({ data }: { data: LoaderData }) {
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const live = data.payments.filter((p) => !p.deletedAt);
  return (
    <Card>
      <h2 className="font-display text-title">Payments</h2>
      {data.payments.length === 0 ? (
        <p className="mt-2 text-secondary">No payments yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-border" aria-label="Payments">
          {data.payments.map((p) => (
            <li key={p.id} className="flex items-start gap-3 py-2.5">
              <div className={p.deletedAt ? "min-w-0 flex-1 text-secondary line-through" : "min-w-0 flex-1"}>
                <p className="font-semibold tabular">
                  {formatCents(p.amountCents)}
                  {p.whtCents > 0 && (
                    <span className="font-normal text-secondary">
                      {" "}
                      + WHT {formatCents(p.whtCents)}
                      {p.whtRateBp ? ` (${formatBp(p.whtRateBp)}%)` : ""}
                    </span>
                  )}
                </p>
                <p className="text-label text-secondary">
                  {formatDate(p.receivedOn)} · {PAYMENT_METHOD_LABEL[p.method]}
                  {p.reference && ` · ${p.reference}`}
                </p>
                {p.deletedAt && <p className="text-label no-underline">Deleted: {p.deleteReason}</p>}
              </div>
              {!p.deletedAt && data.isOwner && data.invoice.status !== "void" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete the payment of ${formatCents(p.amountCents)}`}
                  onClick={() => setDeleting(p.id)}
                >
                  <Trash2 aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {live.length > 0 && (
        <p className="mt-2 text-micro text-secondary">Receipts go to the client by email.</p>
      )}
      <DeletePaymentDialog paymentId={deleting} onClose={() => setDeleting(null)} />
    </Card>
  );
}

function DeletePaymentDialog({ paymentId, onClose }: { paymentId: string | null; onClose: () => void }) {
  const formRef = React.useRef<HTMLFormElement>(null);
  const [reason, setReason] = React.useState("");
  return (
    <>
      <Form method="post" ref={formRef} className="hidden">
        <input type="hidden" name="intent" value="delete_payment" />
        <input type="hidden" name="paymentId" value={paymentId ?? ""} />
        <input type="hidden" name="reason" value={reason} />
      </Form>
      <ConfirmDialog
        open={paymentId !== null}
        onOpenChange={(open) => !open && onClose()}
        title="Delete this payment?"
        description="The balance and status are worked out again. The payment stays in the history, struck through, with your reason."
        confirmLabel="Delete payment"
        destructive
        onConfirm={() => {
          if (reason.trim().length < 3) return false;
          formRef.current?.requestSubmit();
        }}
      >
        <TextField
          label="Reason"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. The transfer was reversed"
        />
      </ConfirmDialog>
    </>
  );
}

function VoidDialog({
  open,
  onOpenChange,
  hasPayments,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasPayments: boolean;
  error: string | null;
}) {
  const navigation = useNavigation();
  const saving = navigation.state !== "idle" && navigation.formData?.get("intent") === "void";
  const formId = React.useId();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={hasPayments ? "Void and reissue?" : "Void this invoice?"}
      description={
        hasPayments
          ? "It keeps its number and is marked VOID. A new draft with the same lines takes over its payments, ready to correct and send."
          : "It keeps its number and is marked VOID. Nothing more is due on it."
      }
      confirmLabel={hasPayments ? "Void and reissue" : "Void invoice"}
      destructive
      loading={saving}
      onConfirm={() => {
        // Stay open: the browser shows a missing reason, and the screen closes it on success.
        const form = document.getElementById(formId) as HTMLFormElement | null;
        if (form?.reportValidity()) form.requestSubmit();
        return false;
      }}
    >
      <Form method="post" id={formId} className="flex flex-col gap-3">
        <input type="hidden" name="intent" value="void" />
        {hasPayments && <input type="hidden" name="reissue" value="on" />}
        <Textarea
          label="Reason"
          name="reason"
          required
          minLength={3}
          maxLength={500}
          error={error ?? undefined}
        />
        {!hasPayments && (
          <label className="flex min-h-11 cursor-pointer items-center gap-3">
            <input type="checkbox" name="reissue" className="size-6 accent-[var(--teal-base)]" />
            Make a corrected copy to send instead
          </label>
        )}
      </Form>
    </ConfirmDialog>
  );
}

// ---------- Draft ----------

function InvoiceBuilder({ data }: { data: LoaderData }) {
  const initial: Draft<InvoiceDraftHeader> = {
    header: headerOf(data),
    sections: data.content.sections,
    documentDiscount: data.content.documentDiscount,
    notes: data.content.notes,
    terms: data.content.terms,
  };
  const { draft, dispatch, status, conflict, overwrite, retry, dirty, version, saveNow } =
    useDraft<InvoiceDraftHeader>({
      endpoint: `/api/invoices/${data.invoice.id}/draft`,
      initial,
      version: data.invoice.draftVersion,
      savedAt: data.invoice.updatedAt,
    });
  const [client, setClient] = React.useState(
    data.client
      ? {
          name: data.client.name,
          company: data.client.company,
          address: data.client.address,
          email: data.client.email,
        }
      : null,
  );
  const [site, setSite] = React.useState(
    data.site ? { label: data.site.label, address: data.site.address } : null,
  );
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [talking, setTalking] = React.useState(false);
  const revalidator = useRevalidator();
  const actionData = useActionData<typeof action>();
  const props = invoiceDocProps(data, draft, client, site);
  const sameClient = !!data.client && draft.header.clientId === data.client.id;
  const due = dueDateOf(draft.header, data.today);
  const revision = data.revising ? data.revising.revisionNo + 1 : 1;
  const generated = data.invoice.kind !== "standard";

  return (
    <div className="flex flex-col gap-4 pb-24 wide:pb-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <BackLink />
        {data.invoice.number && <span className="font-display text-section">{data.invoice.number}</span>}
        <StatusBadge status="draft" />
        <SaveStatus status={status} className="min-h-11" />
        {status.state === "error" && !conflict && (
          <Button type="button" variant="secondary" onClick={() => void retry()}>
            Retry
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)}>
            {data.revising ? <Undo2 aria-hidden /> : <Trash2 aria-hidden />}
            <span className="sr-only tablet:not-sr-only">
              {data.revising ? "Discard changes" : "Delete draft"}
            </span>
          </Button>
          <Button
            type="button"
            onClick={async () => {
              setSending(true);
              if (dirty) await saveNow();
              if (draft.header.clientId && draft.header.clientId !== data.client?.id)
                void revalidator.revalidate();
            }}
          >
            <Send aria-hidden />
            {data.revising ? "Send revision" : "Send"}
          </Button>
        </div>
      </div>

      {data.revising && (
        <div
          role="status"
          className="flex flex-wrap items-start gap-3 rounded-card border border-indigo-base bg-indigo-tint p-4 text-indigo-ink"
        >
          <PencilLine className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1 basis-64">
            <p>
              <span className="font-semibold">
                Revising {data.invoice.number} (rev {revision}).
              </span>{" "}
              It goes out again under the same number as "Revised (rev {revision})"; the client sees rev{" "}
              {data.revising.revisionNo} until then.
            </p>
            <RevisionRequests thread={data.thread} noun="invoice" />
          </div>
          {data.thread && <ConversationButton thread={data.thread} onOpen={() => setTalking(true)} />}
        </div>
      )}
      {data.thread && (
        <ConversationSheet
          open={talking}
          onOpenChange={setTalking}
          entity="invoice"
          entityId={data.invoice.id}
          thread={data.thread}
          clientName={data.client?.name ?? null}
          canHide={data.isOwner}
          dirty={dirty}
        />
      )}
      {generated && !data.revising && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-card border border-border bg-surface-2 p-4"
        >
          <Lock className="mt-0.5 size-5 shrink-0 text-secondary" aria-hidden />
          <p>
            <span className="font-semibold">
              {INVOICE_KIND_LABEL[data.invoice.kind]}
              {data.quote && ` for quote ${data.quote.number}`}.
            </span>{" "}
            Lines from the approved quote are locked so the invoices always add up; add a room or line for
            anything extra.
          </p>
        </div>
      )}
      {data.reissueOf && (
        <p className="text-label text-secondary">
          Reissues voided invoice{" "}
          <Link to={`/invoices/${data.reissueOf.id}`} className="font-semibold text-primary underline">
            {data.reissueOf.number}
          </Link>
          ; its payments ({formatCents(data.settledCents)}) carry over.
        </p>
      )}

      {data.fromExpenses.length > 0 && (
        <p className="text-label text-secondary">
          Lines from expenses:{" "}
          {data.fromExpenses.map((e, n) => (
            <React.Fragment key={e.id}>
              {n > 0 && ", "}
              <Link to={`/expenses?expense=${e.id}`} className="font-semibold text-primary underline">
                {e.supplier}, {formatDate(e.date)}
              </Link>
            </React.Fragment>
          ))}
          . Removing a line makes its expense billable again.
        </p>
      )}

      <BuilderWorkspace
        noun="invoice"
        header={
          <InvoiceHeaderFields
            data={data}
            draft={draft}
            dispatch={dispatch}
            onClient={(name) => setClient(name ? { name, company: null, address: "", email: null } : null)}
            onSite={setSite}
          />
        }
        sections={draft.sections}
        documentDiscount={draft.documentDiscount}
        notes={draft.notes}
        terms={draft.terms}
        dispatch={dispatch}
        totals={props.totals}
        taxRates={data.content.taxRates}
        preview={<DocumentRenderer {...props} />}
        dirty={dirty}
        conflict={!!conflict}
        onOverwrite={overwrite}
        catalogue={{ items: data.items, templates: data.templates, defaultTaxIds: data.defaultTaxIds }}
      />

      <DeleteDraftDialog open={confirmDelete} onOpenChange={setConfirmDelete} revising={!!data.revising} />
      <SendSheet
        open={sending}
        onOpenChange={setSending}
        openRequests={data.thread?.openRequests ?? 0}
        noun="invoice"
        revision={revision}
        number={data.invoice.number}
        nextNumber={data.sendSetup?.nextNumber ?? null}
        wording={data.sendSetup?.wording}
        values={{
          "client.firstName": (sameClient ? data.client!.name : "there").split(/\s+/)[0],
          "client.name": sameClient ? data.client!.name : "",
          "business.name": data.business.name,
          "invoice.number": data.invoice.number ?? data.sendSetup?.nextNumber ?? "",
          "amount.total": formatCents(props.totals.computed.totalCents),
          "amount.due": formatCents(props.totals.computed.totalCents - data.settledCents),
          "date.due": due ? formatDate(due) : "",
          link: "(link to the invoice)",
        }}
        revisedSubject={`Revised invoice ${data.invoice.number} (rev ${revision}) from ${data.business.name}`}
        client={sameClient ? data.client : null}
        totalCents={props.totals.computed.totalCents}
        error={actionData && !actionData.ok && actionData.intent === "send" ? actionData : null}
        version={version}
        saving={dirty && !conflict && status.state !== "error"}
        blocked={
          conflict
            ? "Sort out the newer-version warning first."
            : status.state === "error"
              ? "Your latest changes aren't saved. Retry the save first."
              : !draft.header.clientId
                ? "Choose a client first."
                : draft.sections.every((s) => s.lines.length === 0)
                  ? "Add at least one line first."
                  : !due
                    ? "Choose payment terms or a due date first."
                    : due < data.today
                      ? "The due date has passed; choose a later date."
                      : null
        }
      />
    </div>
  );
}

function DeleteDraftDialog({
  open,
  onOpenChange,
  revising,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  revising: boolean;
}) {
  const formRef = React.useRef<HTMLFormElement>(null);
  return (
    <>
      <Form method="post" ref={formRef} className="hidden">
        <input type="hidden" name="intent" value={revising ? "discard_revision" : "delete"} />
      </Form>
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        title={revising ? "Discard this revision?" : "Delete this draft?"}
        description={
          revising
            ? "Your changes are thrown away and the invoice goes back to the version the client has."
            : "Drafts have no number yet, so nothing is lost from your numbering. This can't be undone."
        }
        confirmLabel={revising ? "Discard changes" : "Delete draft"}
        destructive
        onConfirm={() => formRef.current?.requestSubmit()}
      />
    </>
  );
}

function InvoiceHeaderFields({
  data,
  draft,
  dispatch,
  onClient,
  onSite,
}: {
  data: LoaderData;
  draft: Draft<InvoiceDraftHeader>;
  dispatch: (action: DraftAction<InvoiceDraftHeader>) => void;
  onClient: (name: string | null) => void;
  onSite: (site: { label: string; address: string } | null) => void;
}) {
  const { header } = draft;
  const terms = header.termsDays === null ? "date" : String(header.termsDays);
  return (
    <Card>
      <h2 className="mb-4 font-display text-title">Details</h2>
      <div className="grid gap-4 tablet:grid-cols-2 [&>*]:min-w-0">
        {data.quote && data.client ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-label font-semibold">Client</span>
            <p className="flex min-h-11 items-center">{data.client.name}</p>
          </div>
        ) : (
          <ClientCombobox
            name="builder-client"
            defaultValue={header.clientId}
            onChange={(clientId, name) => {
              dispatch({ type: "header", patch: { clientId, siteId: null } });
              onClient(name);
              onSite(null);
            }}
          />
        )}
        <SiteSelect
          clientId={header.clientId}
          value={header.siteId}
          onChange={(site) => {
            dispatch({ type: "header", patch: { siteId: site?.id ?? null } });
            onSite(site ? { label: site.label, address: site.address } : null);
          }}
        />
        <TextField
          label="Project title"
          value={header.title ?? ""}
          onChange={(e) => dispatch({ type: "header", patch: { title: e.target.value || null } })}
          placeholder="e.g. Living room drapery"
        />
        <TextField
          label="Client's PO or reference"
          value={header.poReference ?? ""}
          maxLength={60}
          onChange={(e) => dispatch({ type: "header", patch: { poReference: e.target.value || null } })}
        />
        <div className="flex flex-col gap-2 tablet:col-span-2">
          <span className="text-label font-semibold">Payment terms</span>
          <SegmentedControl
            label="Payment terms"
            value={terms}
            onValueChange={(next) =>
              dispatch({
                type: "header",
                patch:
                  next === "date"
                    ? { termsDays: null, dueDate: header.dueDate ?? addDays(data.today, 14) }
                    : { termsDays: Number(next), dueDate: null },
              })
            }
            segments={[
              ...TERMS_OPTIONS.map((d) => ({
                value: String(d),
                label: d === 0 ? "On receipt" : `${d} days`,
              })),
              { value: "date", label: "Pick a date" },
            ]}
          />
          {header.termsDays === null ? (
            <DateField
              label="Due date"
              value={header.dueDate ?? ""}
              min={data.today}
              onChange={(e) => dispatch({ type: "header", patch: { dueDate: e.target.value || null } })}
              fieldClassName="max-w-56"
            />
          ) : (
            <p className="text-label text-secondary">
              Due {formatDate(dueDateOf(header, data.today))} if sent today; the date is set when it's sent.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

export { RouteErrorBoundary as ErrorBoundary };

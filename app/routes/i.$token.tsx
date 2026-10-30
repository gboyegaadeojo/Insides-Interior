import { Ban, Check, ClipboardCopy, Download, Link2Off, MessageSquareText, PencilLine } from "lucide-react";
import * as React from "react";
import { data, useActionData, useParams } from "react-router";
import { DocumentRenderer } from "~/components/doc/document-renderer";
import { Button } from "~/components/ui/button";
import { MoneyText } from "~/components/ui/text";
import { toast } from "~/components/ui/toast";
import { computeContent } from "~/domain/document";
import { formatCents } from "~/domain/money";
import { WHOLE_DOCUMENT } from "~/domain/change-requests";
import { formatAddress } from "~/features/clients/service";
import { openLineRefs } from "~/features/conversations/requests";
import { PAYMENT_METHOD_LABEL } from "~/features/invoices/constants";
import { partBilling } from "~/features/invoices/service";
import { conversationAction } from "~/features/portal/action";
import {
  loadPortalInvoice,
  portalThread,
  portalWhatChanged,
  recordInvoiceView,
} from "~/features/portal/service";
import {
  ChangeRequestSheet,
  lineActionFor,
  type PortalResult,
  PortalThread,
  WhatChanged,
} from "~/features/portal/ui/portal-conversation";
import { loadDocBusiness } from "~/features/settings/doc-business";
import { businessToday, formatDate } from "~/lib/dates";
import { cn } from "~/lib/utils";
import { getDb, schema } from "~/server/db";
import { limitPortal, PORTAL_HEADERS, visitorMeta } from "~/server/portal-guard";
import { assertSameOrigin, getUser } from "~/server/session";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/i.$token";

// Payer portal for an invoice (SPEC 6.8, FR-INV-08): balance, how to pay,
// payments received, the invoice, and a way to ask about it. Token only, phone
// first. The only write is a message (FR-MSG-02). `?print=1` is the bare Letter
// page that Browser Rendering prints to PDF (SPEC 10.4).

export function headers() {
  return PORTAL_HEADERS;
}

export function meta({ data: d }: Route.MetaArgs) {
  const robots = { name: "robots", content: "noindex, nofollow" };
  if (!d || d.state === "invalid") return [{ title: "Link not valid" }, robots];
  return [{ title: `Invoice ${d.number} · ${d.business.name}` }, robots];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  await limitPortal(env, request);
  const portal = await loadPortalInvoice(env, params.token);
  if (!portal) return data({ state: "invalid" as const }, { status: 404, headers: PORTAL_HEADERS });

  const print = new URL(request.url).searchParams.get("print") === "1";
  let status = portal.invoice.status;
  if (!print && !(await getUser(env, request))) {
    await recordInvoiceView(env, portal, visitorMeta(request));
    if (status === "sent") status = "viewed";
  }
  const { invoice, revision, client, site, payments } = portal;
  const db = getDb(env);
  const [business, [settings], thread, whatChanged, parts] = await Promise.all([
    loadDocBusiness(db, invoice.businessId),
    db.select().from(schema.settings).where(eq(schema.settings.businessId, invoice.businessId)),
    print ? [] : portalThread(env, "invoice", invoice.id),
    print ? null : portalWhatChanged(env, "invoice", invoice.id, revision),
    partBilling(db, invoice),
  ]);
  const bank = {
    bankName: settings?.bankName ?? null,
    accountName: settings?.accountName ?? null,
    accountNumber: settings?.accountNumber ?? null,
    note: settings?.paymentNote ?? null,
  };
  const state =
    status === "paid"
      ? ("paid" as const)
      : status === "void"
        ? ("void" as const)
        : status === "draft"
          ? ("revising" as const)
          : status === "changes_requested"
            ? ("changes_requested" as const)
            : ("open" as const);
  const content = revision.content;
  return data(
    {
      state,
      print,
      status,
      number: invoice.number!,
      revisionNo: revision.revisionNo,
      revisionId: revision.id,
      title: invoice.title,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      overdue:
        status === "overdue" || (!!invoice.dueDate && invoice.dueDate < businessToday() && state === "open"),
      reference: invoice.poReference,
      business,
      bank,
      client: {
        name: client.displayName,
        company: client.company,
        address: formatAddress(client.billingAddress),
        email: client.email,
      },
      site: site ? { label: site.label, address: formatAddress(site.address) } : null,
      sections: content.sections,
      taxRates: content.taxRates,
      documentDiscount: content.documentDiscount,
      notes: content.notes ?? null,
      terms: content.terms ?? null,
      totalCents: revision.totalCents,
      settledCents: portal.settledCents,
      balanceCents: portal.balanceCents,
      // A deposit or progress invoice: what's still owed on the whole job.
      job: parts && {
        part: invoice.kind === "deposit" ? "deposit" : "progress payment",
        quoteNumber: parts.quoteNumber,
        totalCents: parts.approvedTotalCents,
        paidCents: parts.paidCents,
        remainingCents: parts.remainingCents,
      },
      payments: payments.map((p) => ({
        id: p.id,
        amountCents: p.amountCents + p.whtCents,
        whtCents: p.whtCents,
        receivedOn: p.receivedOn,
        method: p.method,
      })),
      thread: thread.map((m) => ({
        id: m.id,
        from: m.from,
        authorName: m.authorName,
        body: m.body,
        createdAt: m.createdAt,
        hidden: false,
        request: m.request && {
          id: m.request.id,
          kind: m.request.kind,
          lineRef: m.request.lineRef,
          lineLabel: m.request.lineLabel,
          proposedQtyMilli: m.request.proposedQtyMilli,
          status: m.request.status,
          resolutionNote: m.request.resolutionNote,
        },
      })),
      flaggedLines: openLineRefs(thread).filter((ref) => ref !== WHOLE_DOCUMENT),
      whatChanged,
    },
    { headers: PORTAL_HEADERS },
  );
}

export async function action({ request, params, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const env = context.cloudflare.env;
  await limitPortal(env, request);
  const form = await request.formData();
  // CLAUDE.md: a payer can only post a message or a change request here.
  const intent = form.get("intent");
  if (intent !== "message" && intent !== "change_request") throw new Response("Not allowed", { status: 400 });
  return conversationAction(env, "invoice", params.token, form, visitorMeta(request));
}

type LoaderData = Exclude<Route.ComponentProps["loaderData"], { state: "invalid" }>;

export default function InvoicePortal({ loaderData }: Route.ComponentProps) {
  if (loaderData.state === "invalid") return <InvalidLink />;
  if (loaderData.print) return <DocumentRenderer {...docProps(loaderData)} />;
  return <Portal d={loaderData} />;
}

function docProps(d: LoaderData) {
  return {
    kind: "invoice" as const,
    number: d.number,
    revision: d.revisionNo,
    title: d.title,
    issuedOn: d.issueDate,
    untilDate: d.dueDate,
    business: d.business,
    client: d.client,
    site: d.site,
    sections: d.sections,
    taxRates: d.taxRates,
    totals: computeContent({
      sections: d.sections,
      taxRates: d.taxRates,
      documentDiscount: d.documentDiscount,
    }),
    notes: d.notes,
    terms: d.terms,
    reference: d.reference,
    paymentInstructions: [
      d.bank.bankName && `Bank: ${d.bank.bankName}`,
      d.bank.accountName && `Account name: ${d.bank.accountName}`,
      d.bank.accountNumber && `Account number: ${d.bank.accountNumber}`,
      d.bank.note,
    ].filter((x): x is string => !!x),
    settlement: { paidCents: d.settledCents, balanceCents: d.balanceCents },
    stamp: d.state === "paid" ? ("paid" as const) : d.state === "void" ? ("void" as const) : null,
  };
}

function Portal({ d }: { d: LoaderData }) {
  const { token } = useParams();
  const [asking, setAsking] = React.useState(false);
  const [lineRef, setLineRef] = React.useState<string>(WHOLE_DOCUMENT);
  const actionData = useActionData<typeof action>() as PortalResult | undefined;
  const canRequest = d.state === "open" || d.state === "changes_requested";
  const canMessage = d.state !== "void";
  const requestable = d.sections.flatMap((s) =>
    s.lines.map((l) => ({
      id: l.id,
      description: l.description,
      room: s.title,
      qtyMilli: l.qtyMilli,
      unit: l.unit,
      locked: l.locked,
    })),
  );
  const requestChange = (ref: string) => {
    setLineRef(ref);
    setAsking(true);
  };
  const [handled, setHandled] = React.useState(actionData);
  if (actionData !== handled) {
    setHandled(actionData);
    if (actionData?.ok && actionData.intent === "change_request") setAsking(false);
  }
  React.useEffect(() => {
    if (actionData?.ok)
      toast(actionData.intent === "change_request" ? "Your request was sent" : "Message sent", {
        tone: "success",
        description: `${d.business.name} will reply by email.`,
      });
  }, [actionData, d.business.name]);

  return (
    <div className="min-h-dvh bg-canvas text-primary">
      <header className="border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-[8.5in] items-center gap-3 px-4 py-3 tablet:px-6">
          {d.business.logoUrl ? (
            <img
              src={d.business.logoUrl}
              alt={d.business.name}
              className="h-9 w-auto max-w-40 object-contain"
            />
          ) : (
            <span className="font-display text-section">{d.business.name}</span>
          )}
          <a
            href={`/i/${token}/pdf`}
            className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-control px-3 font-semibold hover:bg-surface-2"
          >
            <Download className="size-4.5" aria-hidden />
            PDF
          </a>
        </div>
      </header>

      <main className={cn("mx-auto max-w-[8.5in] px-4 pt-6 tablet:px-6", canRequest ? "pb-36" : "pb-12")}>
        <p className="text-micro font-semibold tracking-[0.12em] text-secondary uppercase">
          Invoice {d.number}
          {d.revisionNo > 1 && ` · Revised (rev ${d.revisionNo})`}
        </p>
        <h1 className="mt-2 font-display text-display">
          {d.title || `Your invoice from ${d.business.name}`}
        </h1>
        <p className="mt-2 text-secondary">For {d.client.name}</p>

        <StatusBanner d={d} />

        {d.whatChanged && <WhatChanged data={d.whatChanged} revisionNo={d.revisionNo} />}

        {d.state !== "void" && d.state !== "revising" && (
          <section
            aria-label="Balance"
            className="mt-6 grid gap-4 rounded-card border border-border bg-surface p-5 shadow-card tablet:grid-cols-2"
          >
            <div>
              <p className="text-micro font-semibold tracking-[0.08em] text-secondary uppercase">
                {d.balanceCents > 0 ? "Balance due" : "Balance"}
              </p>
              <p className="mt-1 font-display text-display tabular" data-testid="portal-balance">
                {formatCents(Math.max(0, d.balanceCents))}
              </p>
              {d.balanceCents > 0 && d.dueDate && (
                <p className={d.overdue ? "mt-1 font-semibold text-danger-ink" : "mt-1 text-secondary"}>
                  {d.overdue ? "Was due " : "Due "}
                  {formatDate(d.dueDate)}
                </p>
              )}
              {d.settledCents > 0 && (
                <p className="mt-1 text-label text-secondary">
                  {formatCents(d.settledCents)} of {formatCents(d.totalCents)} received
                </p>
              )}
              {d.job && <JobBalance job={d.job} />}
            </div>
            {d.balanceCents > 0 && <HowToPay d={d} />}
          </section>
        )}

        {d.payments.length > 0 && (
          <section
            aria-labelledby="payments-heading"
            className="mt-6 rounded-card border border-border bg-surface p-5 shadow-card"
          >
            <h2 id="payments-heading" className="font-display text-title">
              Payments received
            </h2>
            <ul className="mt-3 divide-y divide-border">
              {d.payments.map((p) => (
                <li key={p.id} className="flex items-baseline justify-between gap-3 py-2.5">
                  <span>
                    {formatDate(p.receivedOn)}
                    <span className="block text-label text-secondary">
                      {PAYMENT_METHOD_LABEL[p.method]}
                      {p.whtCents > 0 && ` · includes ${formatCents(p.whtCents)} WHT`}
                    </span>
                  </span>
                  <MoneyText cents={p.amountCents} className="font-semibold" />
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-6 overflow-hidden rounded-card border border-border shadow-card">
          <DocumentRenderer
            {...docProps(d)}
            titleAs="h2"
            className="doc-fluid"
            lineAction={lineActionFor(requestChange, canRequest)}
            flaggedLines={d.flaggedLines}
          />
        </div>

        <PortalThread
          noun="invoice"
          businessName={d.business.name}
          clientName={d.client.name}
          messages={d.thread}
          revisionId={d.revisionId}
          canMessage={canMessage}
          closedReason={`This invoice has been cancelled. Contact ${d.business.name} if you have questions.`}
          result={actionData}
        />
      </main>

      {canRequest && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] shadow-sheet">
          <div className="mx-auto flex max-w-[8.5in] items-center gap-3 px-4 tablet:px-6">
            <div className="min-w-0 flex-1">
              <p className="text-micro font-semibold tracking-[0.08em] text-secondary uppercase">
                Balance due
              </p>
              <MoneyText cents={Math.max(0, d.balanceCents)} className="font-display text-title" />
            </div>
            <Button type="button" variant="secondary" size="lg" onClick={() => requestChange(WHOLE_DOCUMENT)}>
              <MessageSquareText aria-hidden />
              Request a change
            </Button>
          </div>
        </div>
      )}

      <ChangeRequestSheet
        open={asking && canRequest}
        onOpenChange={setAsking}
        noun="invoice"
        businessName={d.business.name}
        clientName={d.client.name}
        lines={requestable}
        lineRef={lineRef}
        onLineRef={setLineRef}
        revisionId={d.revisionId}
        result={actionData}
      />
    </div>
  );
}

function HowToPay({ d }: { d: LoaderData }) {
  const lines = [
    ["Bank", d.bank.bankName],
    ["Account name", d.bank.accountName],
    ["Account number", d.bank.accountNumber],
  ].filter((l): l is [string, string] => !!l[1]);
  if (lines.length === 0 && !d.bank.note) {
    return <p className="text-secondary">Contact {d.business.name} for payment details.</p>;
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast("Account number copied", { tone: "success" });
    } catch {
      toast("Couldn't copy; select the number and copy it", { tone: "error" });
    }
  }
  return (
    <div>
      <h2 className="text-micro font-semibold tracking-[0.08em] text-secondary uppercase">How to pay</h2>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {lines.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt className="text-secondary">{label}</dt>
            <dd className="font-semibold tabular">{value}</dd>
          </React.Fragment>
        ))}
      </dl>
      {d.bank.accountNumber && (
        <Button
          type="button"
          variant="secondary"
          className="mt-3"
          onClick={() => void copy(d.bank.accountNumber!)}
        >
          <ClipboardCopy aria-hidden />
          Copy account number
        </Button>
      )}
      {d.bank.note && <p className="mt-2 text-label text-secondary">{d.bank.note}</p>}
      <p className="mt-2 text-label text-secondary">Please use {d.number} as the transfer reference.</p>
    </div>
  );
}

/** The whole job behind a deposit or progress invoice (owner request). */
function JobBalance({ job }: { job: NonNullable<LoaderData["job"]> }) {
  return (
    <dl
      className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-border pt-3 text-label"
      data-testid="job-balance"
    >
      <dt className="text-secondary">Quote {job.quoteNumber} total</dt>
      <dd className="text-right tabular">{formatCents(job.totalCents)}</dd>
      <dt className="text-secondary">Paid so far</dt>
      <dd className="text-right tabular">{formatCents(job.paidCents)}</dd>
      <dt className="font-semibold">Still to pay on the job</dt>
      <dd className="text-right font-semibold tabular">{formatCents(job.remainingCents)}</dd>
    </dl>
  );
}

function StatusBanner({ d }: { d: LoaderData }) {
  const banner = (tone: string, Icon: typeof Check, title: string, body: React.ReactNode) => (
    <div role="status" className={cn("mt-5 flex gap-3 rounded-card border p-4", tone)}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold">{title}</p>
        <div className="mt-0.5">{body}</div>
      </div>
    </div>
  );
  switch (d.state) {
    case "paid":
      if (d.job && d.job.remainingCents > 0)
        return banner(
          "border-sage-base bg-sage-tint text-sage-ink",
          Check,
          d.job.part === "deposit" ? "Deposit paid" : "Progress payment paid",
          `Thank you. Nothing more is due on ${d.number}. ${formatCents(d.job.remainingCents)} is still to pay on quote ${d.job.quoteNumber}; it will be invoiced separately.`,
        );
      return banner(
        "border-sage-base bg-sage-tint text-sage-ink",
        Check,
        "Paid in full",
        `Thank you. Nothing more is due on ${d.number}.`,
      );
    case "void":
      return banner(
        "border-border bg-surface-2 text-primary",
        Ban,
        "This invoice has been cancelled",
        `Nothing is due on it. ${d.business.name} will send a new one if needed.`,
      );
    case "revising":
      return banner(
        "border-indigo-base bg-indigo-tint text-indigo-ink",
        PencilLine,
        "We're updating this invoice",
        "You'll get the new version by email shortly.",
      );
    case "changes_requested":
      return banner(
        "border-saffron-base bg-saffron-tint text-saffron-ink",
        MessageSquareText,
        "We've got your request",
        `${d.business.name} will reply by email and send a revised invoice if needed.`,
      );
    default:
      return null;
  }
}

function InvalidLink() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <div className="max-w-md rounded-sheet border border-border bg-surface p-8 text-center shadow-card">
        <span className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-surface-2 text-secondary">
          <Link2Off className="size-6" aria-hidden />
        </span>
        <h1 className="mt-4 font-display text-title">This link isn't valid</h1>
        <p className="mt-2 text-secondary">
          It may have been replaced by a newer version of the invoice. Please use the link in your latest
          email, or contact us for a new one.
        </p>
      </div>
    </main>
  );
}

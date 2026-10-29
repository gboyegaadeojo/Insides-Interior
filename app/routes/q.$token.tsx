import { Check, Clock, Download, Link2Off, Mail, MessageSquareText, PencilLine, Phone } from "lucide-react";
import * as React from "react";
import { data, Form, redirect, useActionData, useNavigation, useParams, useSearchParams } from "react-router";
import { DocumentRenderer } from "~/components/doc/document-renderer";
import { Button } from "~/components/ui/button";
import { Celebration } from "~/components/ui/celebration";
import { TextField } from "~/components/ui/field";
import { Sheet, SheetContent } from "~/components/ui/sheet";
import { SignaturePad } from "~/components/ui/signature-pad";
import { MoneyText } from "~/components/ui/text";
import { toast } from "~/components/ui/toast";
import { computeContent, depositFrom } from "~/domain/document";
import { formatCents, lineAmountCents } from "~/domain/money";
import { applySelection, selectedOptionIds } from "~/domain/portal";
import { WHOLE_DOCUMENT } from "~/domain/change-requests";
import { formatAddress } from "~/features/clients/service";
import { openLineRefs } from "~/features/conversations/requests";
import { conversationAction } from "~/features/portal/action";
import { approveSchema } from "~/features/portal/schema";
import {
  approveQuote,
  loadPortalQuote,
  PortalError,
  portalThread,
  portalWhatChanged,
  recordQuoteView,
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
import { getDb } from "~/server/db";
import { limitPortal, PORTAL_HEADERS, visitorMeta } from "~/server/portal-guard";
import { assertSameOrigin, getUser } from "~/server/session";
import type { Route } from "./+types/q.$token";

// Client portal for a quote (SPEC 6.8, FR-QT-10…12, 15). Token only, no
// sign-in; phone first. The visitor can approve (typed name + terms, optional
// drawn signature) or ask for changes, and nothing else. `?print=1` renders the
// bare Letter page that Browser Rendering prints to PDF (SPEC 10.4).

export function headers() {
  return PORTAL_HEADERS;
}

export function meta({ data: d }: Route.MetaArgs) {
  const robots = { name: "robots", content: "noindex, nofollow" };
  if (!d || d.state === "invalid") return [{ title: "Link not valid" }, robots];
  return [{ title: `Quote ${d.number} · ${d.business.name}` }, robots];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  await limitPortal(env, request);
  const portal = await loadPortalQuote(env, params.token);
  if (!portal) return data({ state: "invalid" as const }, { status: 404, headers: PORTAL_HEADERS });

  const print = new URL(request.url).searchParams.get("print") === "1";
  let status = portal.quote.status;
  // The PDF render and the owner checking the link don't count as client views.
  if (!print && !(await getUser(env, request))) {
    await recordQuoteView(env, portal, visitorMeta(request));
    if (status === "sent") status = "viewed";
  }
  const { quote, revision, client, site, acceptance } = portal;
  const [business, thread, whatChanged] = await Promise.all([
    loadDocBusiness(getDb(env), quote.businessId),
    print ? [] : portalThread(env, "quote", quote.id),
    print ? null : portalWhatChanged(env, "quote", quote.id, revision),
  ]);
  const content = revision.content;
  const state =
    status === "approved"
      ? ("approved" as const)
      : status === "expired"
        ? ("expired" as const)
        : status === "draft"
          ? ("revising" as const)
          : status === "changes_requested"
            ? ("changes_requested" as const)
            : status === "sent" || status === "viewed"
              ? ("open" as const)
              : ("closed" as const);
  return data(
    {
      state,
      print,
      number: quote.number!,
      revisionNo: revision.revisionNo,
      revisionId: revision.id,
      title: quote.title,
      issuedOn: revision.sentAt ? businessToday(new Date(revision.sentAt)) : null,
      validUntil: quote.validUntil,
      business,
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
      deposit:
        revision.depositType && revision.depositValue !== null
          ? { type: revision.depositType, value: revision.depositValue }
          : null,
      notes: content.notes ?? null,
      terms: content.terms ?? null,
      acceptance: acceptance
        ? {
            signerName: acceptance.signerName,
            acceptedAt: acceptance.acceptedAt,
            totalCents: acceptance.acceptedTotalCents,
            selected: acceptance.selectedOptionLineIds,
          }
        : null,
      thread: threadView(thread),
      flaggedLines: openLineRefs(thread).filter((ref) => ref !== WHOLE_DOCUMENT),
      whatChanged,
    },
    { headers: PORTAL_HEADERS },
  );
}

/** Only what the portal shows of a thread (no revision or request ids beyond the card). */
function threadView(thread: Awaited<ReturnType<typeof portalThread>>) {
  return thread.map((m) => ({
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
  }));
}

export async function action({ request, params, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const env = context.cloudflare.env;
  await limitPortal(env, request);
  const form = await request.formData();
  const intent = form.get("intent");
  // CLAUDE.md: the portal allows approve, message and change request, nothing else.
  if (intent !== "approve" && intent !== "message" && intent !== "change_request") {
    throw new Response("Not allowed", { status: 400 });
  }
  if (intent !== "approve") {
    return conversationAction(env, "quote", params.token, form, visitorMeta(request));
  }
  const parsed = approveSchema.safeParse({
    intent,
    revisionId: form.get("revisionId"),
    options: form.getAll("option"),
    signerName: form.get("signerName") ?? "",
    signerEmail: form.get("signerEmail") ?? "",
    agree: form.get("agree") ?? undefined,
    signature: form.get("signature") ?? undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return data({ ok: false as const, intent, fieldErrors, error: null, code: "input" }, { status: 400 });
  }
  try {
    await approveQuote(env, params.token, parsed.data, visitorMeta(request));
    return redirect(`/q/${params.token}?approved=1`, { headers: PORTAL_HEADERS });
  } catch (error) {
    if (error instanceof PortalError) {
      return data(
        {
          ok: false as const,
          intent,
          fieldErrors: error.field ? { [error.field]: error.message } : {},
          error: error.field ? null : error.message,
          code: error.code,
        },
        { status: error.code === "input" ? 400 : 409 },
      );
    }
    throw error;
  }
}

type LoaderData = Exclude<Route.ComponentProps["loaderData"], { state: "invalid" }>;

export default function QuotePortal({ loaderData }: Route.ComponentProps) {
  if (loaderData.state === "invalid") return <InvalidLink />;
  if (loaderData.print) return <PrintView d={loaderData} />;
  return <Portal d={loaderData} />;
}

function useDocument(d: LoaderData, selected: Iterable<string>) {
  const content = { sections: d.sections, taxRates: d.taxRates, documentDiscount: d.documentDiscount };
  const chosen = applySelection(content, selected);
  return {
    sections: chosen.sections,
    totals: computeContent(chosen, depositFrom(d.deposit?.type, d.deposit?.value)),
  };
}

function docProps(d: LoaderData) {
  return {
    kind: "quote" as const,
    number: d.number,
    revision: d.revisionNo,
    title: d.title,
    issuedOn: d.issuedOn,
    untilDate: d.validUntil,
    business: d.business,
    client: d.client,
    site: d.site,
    taxRates: d.taxRates,
    deposit: d.deposit,
    notes: d.notes,
    terms: d.terms,
    stamp: d.state === "approved" ? ("approved" as const) : null,
  };
}

/** The bare page Browser Rendering prints (SPEC 10.4). */
function PrintView({ d }: { d: LoaderData }) {
  const { sections, totals } = useDocument(d, d.acceptance?.selected ?? selectedOptionIds(d));
  return <DocumentRenderer {...docProps(d)} sections={sections} totals={totals} />;
}

function Portal({ d }: { d: LoaderData }) {
  const { token } = useParams();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(d.acceptance?.selected ?? selectedOptionIds(d)),
  );
  const { sections, totals } = useDocument(d, selected);
  const [sheet, setSheet] = React.useState<null | "approve" | "changes">(null);
  const [lineRef, setLineRef] = React.useState<string>(WHOLE_DOCUMENT);
  const actionData = useActionData<typeof action>() as PortalResult | undefined;
  const options = d.sections.flatMap((s) =>
    s.lines.filter((l) => l.optional).map((l) => ({ ...l, room: s.title })),
  );
  const requestable = d.sections.flatMap((s) =>
    s.lines.map((l) => ({
      id: l.id,
      description: l.description,
      room: s.title,
      qtyMilli: l.qtyMilli,
      unit: l.unit,
    })),
  );
  const canApprove = d.state === "open";
  const canRequest = d.state === "open" || d.state === "changes_requested";
  const canMessage = d.state !== "closed";
  const composerRef = React.useRef<HTMLTextAreaElement>(null);
  const requestChange = (ref: string) => {
    setLineRef(ref);
    setSheet("changes");
  };

  // A change request went through: close the sheet (during render, as React
  // recommends for state derived from a new result) and say so.
  const [handled, setHandled] = React.useState(actionData);
  if (actionData !== handled) {
    setHandled(actionData);
    if (actionData?.ok && actionData.intent === "change_request") setSheet(null);
  }
  React.useEffect(() => {
    if (actionData?.ok && actionData.intent !== "approve") {
      toast(actionData.intent === "change_request" ? "Your request was sent" : "Message sent", {
        tone: "success",
        description: `${d.business.name} will reply by email.`,
      });
    }
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
            href={`/q/${token}/pdf`}
            className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-control px-3 font-semibold hover:bg-surface-2"
          >
            <Download className="size-4.5" aria-hidden />
            PDF
          </a>
        </div>
      </header>

      <main className={cn("mx-auto max-w-[8.5in] px-4 pt-6 tablet:px-6", canRequest ? "pb-40" : "pb-12")}>
        <p className="text-micro font-semibold tracking-[0.12em] text-secondary uppercase">
          Quote {d.number}
          {d.revisionNo > 1 && ` · Revised (rev ${d.revisionNo})`}
        </p>
        <h1 className="mt-2 font-display text-display">{d.title || `Your quote from ${d.business.name}`}</h1>
        <p className="mt-2 text-secondary">
          Prepared for {d.client.name}
          {d.validUntil && d.state === "open" && <> · valid until {formatDate(d.validUntil)}</>}
        </p>

        <StatusBanner d={d} />

        {d.whatChanged && <WhatChanged data={d.whatChanged} revisionNo={d.revisionNo} />}

        {options.length > 0 && canApprove && (
          <section
            aria-labelledby="options-heading"
            className="mt-6 rounded-card border border-border bg-surface p-4 shadow-card tablet:p-5"
          >
            <h2 id="options-heading" className="font-display text-title">
              Choose your options
            </h2>
            <p className="mt-1 text-label text-secondary">
              Optional items aren't in the total until you choose them. Base total{" "}
              <MoneyText cents={totals.baseTotalCents} className="font-semibold text-primary" />.
            </p>
            <ul className="mt-3 divide-y divide-border">
              {options.map((option) => (
                <li key={option.id}>
                  <label className="flex min-h-13 cursor-pointer items-center gap-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(option.id)}
                      onChange={(e) =>
                        setSelected((s) => {
                          const next = new Set(s);
                          if (e.target.checked) next.add(option.id);
                          else next.delete(option.id);
                          return next;
                        })
                      }
                      className="size-6 shrink-0 accent-[var(--teal-base)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{option.description || "Option"}</span>
                      <span className="block text-label text-secondary">{option.room}</span>
                    </span>
                    <MoneyText
                      cents={
                        totals.byLine.get(option.id)?.included
                          ? totals.byLine.get(option.id)!.amountCents
                          : lineAmountCents(option.qtyMilli, option.unitPriceCents)
                      }
                      className="font-semibold"
                    />
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-6 overflow-hidden rounded-card border border-border shadow-card">
          <DocumentRenderer
            {...docProps(d)}
            sections={sections}
            totals={totals}
            titleAs="h2"
            className="doc-fluid"
            lineAction={lineActionFor(requestChange, canRequest)}
            flaggedLines={d.flaggedLines}
          />
        </div>

        <PortalThread
          noun="quote"
          businessName={d.business.name}
          clientName={d.client.name}
          messages={d.thread}
          revisionId={d.revisionId}
          canMessage={canMessage}
          closedReason={`This quote is closed. Contact ${d.business.name} if you have questions.`}
          result={actionData}
          composerRef={composerRef}
        />
      </main>

      {canRequest && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] shadow-sheet">
          {/* Phone: the total on its own row, buttons sharing the row below; tablet up: one row. */}
          <div className="mx-auto flex max-w-[8.5in] flex-wrap items-center gap-2 px-4 tablet:flex-nowrap tablet:gap-3 tablet:px-6">
            <div
              className="flex min-w-0 basis-full items-baseline justify-between gap-3 tablet:block tablet:flex-1 tablet:basis-auto"
              aria-live="polite"
              data-testid="portal-total"
            >
              <p className="text-micro font-semibold tracking-[0.08em] text-secondary uppercase">
                {totals.hasOptions ? "Your selection" : "Total"}
              </p>
              <MoneyText cents={totals.computed.totalCents} className="font-display text-title" />
            </div>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="flex-1 tablet:flex-none"
              onClick={() => requestChange(WHOLE_DOCUMENT)}
            >
              <MessageSquareText aria-hidden />
              Request changes
            </Button>
            {canApprove && (
              <Button
                type="button"
                size="lg"
                className="flex-1 tablet:flex-none"
                onClick={() => setSheet("approve")}
              >
                <Check aria-hidden />
                Approve
              </Button>
            )}
          </div>
        </div>
      )}

      <ApproveSheet
        // Closes by itself once the quote is approved (or stops being approvable).
        open={sheet === "approve" && canApprove}
        onOpenChange={(open) => setSheet(open ? "approve" : null)}
        d={d}
        selected={[...selected]}
        totalCents={totals.computed.totalCents}
        depositCents={totals.depositCents}
        result={actionData?.intent === "approve" ? actionData : undefined}
      />
      <ChangeRequestSheet
        open={sheet === "changes" && canRequest}
        onOpenChange={(open) => setSheet(open ? "changes" : null)}
        noun="quote"
        businessName={d.business.name}
        clientName={d.client.name}
        lines={requestable}
        lineRef={lineRef}
        onLineRef={setLineRef}
        revisionId={d.revisionId}
        result={actionData}
      />
      <Celebration
        show={params.get("approved") === "1"}
        label="Approved"
        onDone={() => setParams({}, { replace: true, preventScrollReset: true })}
      />
    </div>
  );
}

function StatusBanner({ d }: { d: LoaderData }) {
  const contact = (
    <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {d.business.phone && (
        <a
          href={`tel:${d.business.phone}`}
          className="inline-flex min-h-11 items-center gap-1.5 font-semibold underline"
        >
          <Phone className="size-4" aria-hidden />
          {d.business.phone}
        </a>
      )}
      {d.business.email && (
        <a
          href={`mailto:${d.business.email}`}
          className="inline-flex min-h-11 items-center gap-1.5 font-semibold underline"
        >
          <Mail className="size-4" aria-hidden />
          {d.business.email}
        </a>
      )}
    </span>
  );
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
    case "approved":
      return banner(
        "border-sage-base bg-sage-tint text-sage-ink",
        Check,
        d.acceptance
          ? `Approved by ${d.acceptance.signerName} on ${formatDate(businessToday(new Date(d.acceptance.acceptedAt)))}`
          : "Approved",
        <>
          Thank you. {d.business.name} will be in touch about next steps.
          {d.acceptance && <> Approved total {formatCents(d.acceptance.totalCents)}.</>}
        </>,
      );
    case "expired":
      return banner(
        "border-roseclay-base bg-roseclay-tint text-roseclay-ink",
        Clock,
        `This quote expired${d.validUntil ? ` on ${formatDate(d.validUntil)}` : ""}`,
        <>
          Please contact {d.business.name} for an updated quote.
          {contact}
        </>,
      );
    case "revising":
      return banner(
        "border-indigo-base bg-indigo-tint text-indigo-ink",
        PencilLine,
        "We're updating this quote",
        "You'll get the new version by email shortly. This one can't be approved in the meantime.",
      );
    case "changes_requested":
      return banner(
        "border-saffron-base bg-saffron-tint text-saffron-ink",
        MessageSquareText,
        "We've got your request",
        `${d.business.name} will reply by email and send a revised quote if needed.`,
      );
    case "closed":
      return banner(
        "border-border bg-surface-2 text-primary",
        Clock,
        "This quote is closed",
        <>
          Please contact {d.business.name} if you have questions.{contact}
        </>,
      );
    default:
      return null;
  }
}

function ApproveSheet({
  open,
  onOpenChange,
  d,
  selected,
  totalCents,
  depositCents,
  result,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  d: LoaderData;
  selected: string[];
  totalCents: number;
  depositCents: number;
  result?: { fieldErrors: Record<string, string>; error: string | null; code: string | null };
}) {
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle" && navigation.formData?.get("intent") === "approve";
  const formId = React.useId();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title="Approve this quote"
        description={`Quote ${d.number} from ${d.business.name}`}
        footer={
          <Button type="submit" form={formId} size="lg" className="w-full" loading={submitting}>
            <Check aria-hidden />
            Approve {formatCents(totalCents)}
          </Button>
        }
      >
        <Form method="post" id={formId} className="flex flex-col gap-5" preventScrollReset>
          <input type="hidden" name="intent" value="approve" />
          <input type="hidden" name="revisionId" value={d.revisionId} />
          {selected.map((id) => (
            <input key={id} type="hidden" name="option" value={id} />
          ))}
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-card bg-surface-2 p-4">
            <dt className="text-secondary">Total{selected.length > 0 ? " with your options" : ""}</dt>
            <dd className="text-right font-semibold tabular">{formatCents(totalCents)}</dd>
            {depositCents > 0 && (
              <>
                <dt className="text-secondary">Deposit due on approval</dt>
                <dd className="text-right font-semibold tabular">{formatCents(depositCents)}</dd>
              </>
            )}
          </dl>
          {result?.error && (
            <p
              role="alert"
              className="rounded-card border border-danger-base bg-danger-tint p-3 font-semibold text-danger-ink"
            >
              {result.error}
              {result.code === "stale" && (
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-2 w-full"
                  onClick={() => window.location.reload()}
                >
                  See the latest version
                </Button>
              )}
            </p>
          )}
          <TextField
            label="Your full name"
            name="signerName"
            autoComplete="name"
            required
            error={result?.fieldErrors.signerName}
            hint="Typing your name is your signature"
          />
          <TextField
            label="Email for your copy"
            name="signerEmail"
            type="email"
            autoComplete="email"
            defaultValue={d.client.email ?? ""}
            error={result?.fieldErrors.signerEmail}
          />
          {/* FR-QT-15: drawn signature for approving in person on a tablet. */}
          <SignaturePad name="signature" className="hidden tablet:flex" />
          <div className="flex flex-col gap-1.5">
            <label className="flex min-h-11 cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                name="agree"
                required
                aria-invalid={result?.fieldErrors.agree ? true : undefined}
                className="mt-0.5 size-6 shrink-0 accent-[var(--teal-base)]"
              />
              <span>
                I approve quote {d.number} for <strong className="tabular">{formatCents(totalCents)}</strong>{" "}
                and agree to its terms.
              </span>
            </label>
            {result?.fieldErrors.agree && (
              <p role="alert" className="text-label font-semibold text-danger-ink">
                {result.fieldErrors.agree}
              </p>
            )}
          </div>
        </Form>
      </SheetContent>
    </Sheet>
  );
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
          It may have been replaced by a newer version of the quote. Please use the link in your latest email,
          or contact us for a new one.
        </p>
      </div>
    </main>
  );
}

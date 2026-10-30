import {
  BellOff,
  BellRing,
  CalendarPlus,
  Check,
  ChevronLeft,
  Copy,
  FileDown,
  FolderOpen,
  PencilLine,
  Receipt,
  RefreshCw,
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
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { DateField, TextField } from "~/components/ui/field";
import { MoneyField } from "~/components/ui/number-fields";
import { SaveStatus } from "~/components/ui/save-status";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { StatusBadge } from "~/components/ui/status-badge";
import { toast } from "~/components/ui/toast";
import { computeContent, depositFrom } from "~/domain/document";
import { jobSentence, jobStage } from "~/domain/job";
import { canQuote } from "~/domain/lifecycle";
import { formatBp, formatCents, parseMoneyToCents } from "~/domain/money";
import { applySelection, isPastValidUntil } from "~/domain/portal";
import { ClientCombobox } from "~/features/clients/ui/client-combobox";
import { formatAddress } from "~/features/clients/service";
import { listTemplates } from "~/features/catalogue/service";
import { SiteSelect } from "~/features/projects/ui/site-select";
import { fromQuoteSchema } from "~/features/invoices/schema";
import { createInvoiceFromQuote, invoicesForQuote } from "~/features/invoices/service";
import { INVOICE_KIND_LABEL } from "~/features/invoices/constants";
import { sendQuoteSchema } from "~/features/quotes/schema";
import {
  builderCatalogue,
  deleteDraft,
  discardRevision,
  DraftConflictError,
  duplicateQuote,
  extendQuote,
  getQuote,
  quoteHistory,
  quoteShareUrl,
  retryQuoteEmail,
  reviseQuote,
  rotateQuoteLink,
  sendQuote,
  sendSetup,
  setFollowUpPaused,
} from "~/features/quotes/service";
import { ownerThread, threadPanelData } from "~/features/conversations/service";
import {
  ConversationButton,
  ConversationSheet,
  RevisionRequests,
} from "~/features/conversations/ui/conversation-sheet";
import { ThreadPanel } from "~/features/conversations/ui/thread-panel";
import { JobActionButton, JobSteps, NextStepCard, NextStepInline } from "~/features/jobs/ui/job-steps";
import { BuilderWorkspace } from "~/features/documents/ui/builder-workspace";
import { ClientLinkCard, HistoryCard } from "~/features/documents/ui/history-card";
import { SendSheet } from "~/features/documents/ui/send-sheet";
import { SentDocumentLayout } from "~/features/documents/ui/sent-layout";
import type { BuilderItem } from "~/features/documents/ui/catalogue-sheet";
import { type Draft, type DraftAction, useDraft } from "~/features/documents/ui/use-draft";
import { loadDocBusiness } from "~/features/settings/doc-business";
import { activeTaxRates, ServiceError } from "~/features/settings/service";
import { relativeTime } from "~/lib/activity-label";
import { businessToday, formatDate } from "~/lib/dates";
import type { AppHandle } from "~/lib/route-handle";
import { useNotice } from "~/lib/use-notice";
import { signedFileUrl } from "~/server/files";
import { assertSameOrigin, requireUser } from "~/server/session";
import type { Route } from "./+types/_app.quotes.$id";

export const handle: AppHandle = { module: "quotes", title: "Quote" };

export function meta({ data: d }: Route.MetaArgs) {
  return [{ title: `${d?.quote.number ?? "Draft quote"} · Insides Interior` }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const ctx = await requireUser(context.cloudflare.env, request);
  const detail = await getQuote(ctx, params.id);
  if (!detail) throw new Response("Not found", { status: 404 });
  const isDraft = detail.quote.status === "draft";
  const [business, items, templates, rates, history, setup, shareUrl, invoices, thread] = await Promise.all([
    loadDocBusiness(ctx.db, ctx.user.businessId),
    isDraft ? builderCatalogue(ctx) : [],
    isDraft ? listTemplates(ctx) : [],
    isDraft ? activeTaxRates(ctx) : [],
    detail.quote.number ? quoteHistory(ctx, params.id) : null,
    isDraft ? sendSetup(ctx) : null,
    detail.quote.shareTokenSalt ? quoteShareUrl(ctx.env, params.id, detail.quote.shareTokenSalt) : null,
    detail.quote.status === "approved" ? invoicesForQuote(ctx, params.id) : [],
    detail.quote.number ? ownerThread(ctx, "quote", params.id) : null,
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
  const { shareTokenHash: _hash, shareTokenSalt: _salt, ...quote } = detail.quote;
  const issuedOn = detail.revision?.sentAt ? businessToday(new Date(detail.revision.sentAt)) : null;
  const acceptedAt = history?.acceptance?.acceptedAt;
  // Owner request: every quote is a job moving through seven steps.
  const stage = jobStage({
    quoteStatus: quote.status,
    pastValidUntil: isPastValidUntil(quote.validUntil, businessToday()),
    hasDeposit: !!quote.depositType && !!quote.depositValue,
    sentOn: issuedOn,
    approvedOn: acceptedAt ? businessToday(new Date(acceptedAt)) : null,
    invoices: invoices.map((i) => ({ ...i, balanceCents: 0 })),
  });
  return {
    quote,
    stage,
    content: detail.content,
    revisionNo: detail.revisionNo,
    revising: detail.revising,
    issuedOn,
    history,
    invoices,
    sendSetup: setup,
    shareUrl,
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
    thread: thread && threadPanelData(thread),
    isOwner: ctx.user.role === "owner",
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const ctx = await requireUser(context.cloudflare.env, request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const done = (message: string, extra: Record<string, unknown> = {}) =>
    data({ ok: true as const, intent, message, error: null, field: null, ...extra });
  try {
    switch (intent) {
      case "duplicate":
        return redirect(`/quotes/${await duplicateQuote(ctx, params.id)}`);
      case "delete":
        await deleteDraft(ctx, params.id);
        return redirect("/quotes");
      case "send": {
        const parsed = sendQuoteSchema.safeParse(Object.fromEntries(form));
        if (!parsed.success) {
          const issue = parsed.error.issues[0]!;
          return data(
            { ok: false as const, intent, error: issue.message, field: String(issue.path[0]), message: null },
            { status: 400 },
          );
        }
        const sent = await sendQuote(ctx, params.id, parsed.data);
        return done(
          sent.queued
            ? `${sent.number}${sent.revisionNo > 1 ? ` (rev ${sent.revisionNo})` : ""} sent to ${parsed.data.to}`
            : `${sent.number} is sent; its email is waiting. Retry it from the history.`,
        );
      }
      case "revise":
        await reviseQuote(ctx, params.id);
        return done("Editing a new revision. The client sees the current one until you send it.");
      case "discard_revision":
        await discardRevision(ctx, params.id);
        return done("Revision discarded");
      case "extend":
        return done(`Valid until ${formatDate(await extendQuote(ctx, params.id))}`);
      case "rotate_link":
        await rotateQuoteLink(ctx, params.id);
        return done("New link made. The old link no longer works.");
      case "pause_follow_ups":
      case "resume_follow_ups":
        await setFollowUpPaused(ctx, params.id, intent === "pause_follow_ups");
        return done(intent === "pause_follow_ups" ? "Follow-ups paused" : "Follow-ups back on");
      case "retry_email":
        await retryQuoteEmail(ctx, params.id);
        return done("Email queued again");
      case "create_invoice": {
        const parsed = fromQuoteSchema.safeParse(Object.fromEntries(form));
        if (!parsed.success) {
          const issue = parsed.error.issues[0]!;
          return data(
            { ok: false as const, intent, error: issue.message, field: String(issue.path[0]), message: null },
            { status: 400 },
          );
        }
        return redirect(`/invoices/${await createInvoiceFromQuote(ctx, params.id, parsed.data)}`);
      }
    }
  } catch (error) {
    if (error instanceof DraftConflictError) {
      return data(
        {
          ok: false as const,
          intent,
          error: "This quote changed in another tab. Reload, check it, then send.",
          field: null,
          message: null,
        },
        { status: 409 },
      );
    }
    if (error instanceof ServiceError) {
      return data(
        { ok: false as const, intent, error: error.message, field: error.field ?? null, message: null },
        { status: 400 },
      );
    }
    throw error;
  }
  throw new Response("Unknown action", { status: 400 });
}

type LoaderData = Route.ComponentProps["loaderData"];

export default function QuoteScreen({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  useNotice();
  // One toast per action result (sent, revised, extended…).
  React.useEffect(() => {
    if (!actionData) return;
    if (actionData.ok) toast(actionData.message, { tone: "success" });
    else if (actionData.intent !== "send") toast(actionData.error ?? "That didn't work", { tone: "error" });
  }, [actionData]);
  return loaderData.quote.status === "draft" ? (
    <Builder
      // Accepting a change request rewrites the draft on the server: start the editor afresh.
      key={`${loaderData.quote.id}-${loaderData.revising?.revisionNo ?? 0}-${loaderData.thread?.acceptedPending ?? 0}`}
      data={loaderData}
    />
  ) : (
    <SentQuote data={loaderData} />
  );
}

function previewProps(
  data: LoaderData,
  draft: Pick<Draft, "header" | "sections" | "notes" | "terms" | "documentDiscount">,
  client: DocumentRendererProps["client"],
  site: DocumentRendererProps["site"],
): DocumentRendererProps {
  const content = {
    sections: draft.sections,
    documentDiscount: draft.documentDiscount,
    taxRates: data.content.taxRates,
  };
  const deposit =
    draft.header.depositType && draft.header.depositValue !== null
      ? { type: draft.header.depositType, value: draft.header.depositValue }
      : null;
  return {
    kind: "quote",
    number: data.quote.number,
    revision: data.revisionNo,
    title: draft.header.title,
    issuedOn: data.today,
    untilDate: draft.header.validUntil,
    business: data.business,
    client,
    site,
    sections: draft.sections,
    taxRates: data.content.taxRates,
    totals: computeContent(content, depositFrom(deposit?.type, deposit?.value)),
    deposit,
    notes: draft.notes,
    terms: draft.terms,
  };
}

function BackLink() {
  return (
    <Link
      to="/quotes"
      className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-control px-2 font-semibold text-plum-ink"
    >
      <ChevronLeft className="size-5" aria-hidden />
      Quotes
    </Link>
  );
}

function SentQuote({ data }: { data: LoaderData }) {
  const { header: _header, ...content } = data.content;
  const acceptance = data.history?.acceptance;
  const props = previewProps(
    data,
    {
      header: {
        title: data.quote.title,
        clientId: data.quote.clientId,
        siteId: data.quote.siteId,
        validUntil: data.quote.validUntil,
        depositType: data.quote.depositType,
        depositValue: data.quote.depositValue,
      },
      // An approved quote shows the options the client chose.
      ...(acceptance ? applySelection(content, acceptance.selectedOptionLineIds) : content),
    },
    data.client,
    data.site,
  );
  // The day it was sent, as the client sees it (validity sentence, FR-QT-11).
  props.issuedOn = data.issuedOn;
  props.stamp = data.quote.status === "approved" ? "approved" : null;
  const status = data.quote.status;
  const pastDate = isPastValidUntil(data.quote.validUntil, data.today);
  const canExtend =
    status === "expired" || (pastDate && ["sent", "viewed", "changes_requested"].includes(status));
  const canRevise = canQuote(status, "revise");
  const navigation = useNavigation();
  const busy = (intent: string) =>
    navigation.state !== "idle" && navigation.formData?.get("intent") === intent;

  const stage = data.stage;
  const sentence = jobSentence(stage, {
    clientFirstName: data.client?.name.split(/s+/)[0] ?? "",
    depositAmount: props.totals.depositCents ? formatCents(props.totals.depositCents) : undefined,
    balance: props.totals.depositCents ? formatCents(props.totals.balanceCents) : undefined,
    sentOn: data.issuedOn ? formatDate(data.issuedOn) : undefined,
    approvedOn: stage.steps[1]?.date ? formatDate(stage.steps[1].date) : undefined,
  });
  const nextButton = <JobActionButton stage={stage} quoteId={data.quote.id} className="w-full" />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <BackLink />
        <span className="font-display text-section">{data.quote.number}</span>
        <StatusBadge
          status={pastDate && status !== "approved" ? "expired" : status}
          revision={data.revisionNo ?? undefined}
        />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button asChild variant="ghost">
            <a href={`/quotes/${data.quote.id}/pdf`} target="_blank" rel="noreferrer">
              <FileDown aria-hidden />
              PDF
            </a>
          </Button>
          <Form method="post">
            <input type="hidden" name="intent" value="duplicate" />
            <Button type="submit" variant="ghost" loading={busy("duplicate")}>
              <Copy aria-hidden />
              <span className="sr-only tablet:not-sr-only">Duplicate</span>
            </Button>
          </Form>
          {canExtend && (
            <Form method="post">
              <input type="hidden" name="intent" value="extend" />
              <Button type="submit" variant="secondary" loading={busy("extend")}>
                <CalendarPlus aria-hidden />
                Extend
              </Button>
            </Form>
          )}
          {canRevise && (
            <Form method="post">
              <input type="hidden" name="intent" value="revise" />
              <Button type="submit" loading={busy("revise")}>
                <PencilLine aria-hidden />
                Revise
              </Button>
            </Form>
          )}
        </div>
      </div>

      <div>
        <h1 className="text-display">{data.quote.title || data.quote.number}</h1>
        <p className="mt-1 text-secondary">
          {data.client?.name ?? "No client"} · {formatCents(props.totals.computed.totalCents)}
        </p>
      </div>
      <JobSteps stage={stage} next={<NextStepInline sentence={sentence} button={nextButton} />} />
      <NextStepCard stage={stage} sentence={sentence} button={stage.action ? nextButton : null} />

      <SentDocumentLayout
        document={
          <Paper className="mx-auto max-w-[816px]">
            <DocumentRenderer {...props} flaggedLines={data.thread?.openLines} />
          </Paper>
        }
        cards={
          <>
            {acceptance && <ApprovalCard acceptance={acceptance} projectId={data.quote.projectId} />}
            {status === "approved" && <QuoteInvoicesCard data={data} />}
            {(status === "sent" || status === "viewed") && !pastDate && (
              <FollowUpsCard paused={data.quote.followUpPaused} busy={busy} />
            )}
          </>
        }
        thread={
          data.thread && (
            <ThreadPanel
              entity="quote"
              entityId={data.quote.id}
              thread={data.thread}
              clientName={data.client?.name ?? null}
              canReply
              canHide={data.isOwner}
              heading
            />
          )
        }
        threadCount={(data.thread?.openRequests ?? 0) + (data.thread?.unreadBefore ?? 0)}
        attention={!!data.thread && (data.thread.openRequests > 0 || data.thread.unreadBefore > 0)}
        moreCards={
          <>
            {data.shareUrl && <ClientLinkCard url={data.shareUrl} busy={busy("rotate_link")} noun="quote" />}
            {data.history && <HistoryCard history={data.history} retrying={busy("retry_email")} />}
          </>
        }
      />
    </div>
  );
}

/**
 * FR-QT-12, FR-INV-01: invoices from the approved quote. Deposit uses the
 * quote's terms; progress bills a % or an amount; final credits everything
 * already invoiced so the parts add up to the quote; "in full" is an ordinary
 * editable copy.
 */
function QuoteInvoicesCard({ data }: { data: LoaderData }) {
  const navigation = useNavigation();
  const actionData = useActionData<typeof action>();
  const [progress, setProgress] = React.useState(false);
  const [portionType, setPortionType] = React.useState<"percent" | "amount">("percent");
  const [amount, setAmount] = React.useState<number | null>(null);
  const live = data.invoices.filter((i) => i.status !== "void");
  const has = (kind: string) => live.some((i) => i.kind === kind);
  const creating = (kind: string) =>
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "create_invoice" &&
    navigation.formData?.get("kind") === kind;
  const error =
    actionData && !actionData.ok && actionData.intent === "create_invoice" ? actionData.error : null;
  const createButton = (kind: string, label: string, variant: "primary" | "secondary" = "secondary") => (
    <Form method="post">
      <input type="hidden" name="intent" value="create_invoice" />
      <input type="hidden" name="kind" value={kind} />
      <Button type="submit" variant={variant} className="w-full" loading={creating(kind)}>
        <Receipt aria-hidden />
        {label}
      </Button>
    </Form>
  );
  return (
    <Card>
      <h2 className="font-display text-title">Invoices</h2>
      {data.invoices.length > 0 ? (
        <ul className="mt-3 flex flex-col divide-y divide-border" aria-label="Invoices for this quote">
          {data.invoices.map((inv) => (
            <li key={inv.id}>
              <Link
                to={`/invoices/${inv.id}`}
                className="flex min-h-11 items-center justify-between gap-3 py-2 hover:text-indigo-ink"
              >
                <span>
                  <span className="font-semibold">{inv.number ?? "Draft"}</span>{" "}
                  <span className="text-label text-secondary">{INVOICE_KIND_LABEL[inv.kind]}</span>
                </span>
                <StatusBadge status={inv.status} size="sm" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-label text-secondary">
          {data.quote.depositType ? "Next step: the deposit invoice." : "Bill it in parts or in full."}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-label font-semibold text-danger-ink">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-col gap-2">
        {data.quote.depositType && !has("deposit") && createButton("deposit", "Deposit invoice", "primary")}
        {progress ? (
          <Form method="post" className="flex flex-col gap-3 rounded-card border border-border p-3">
            <input type="hidden" name="intent" value="create_invoice" />
            <input type="hidden" name="kind" value="progress" />
            <input type="hidden" name="portionType" value={portionType} />
            <SegmentedControl
              label="Bill a percentage or an amount"
              value={portionType}
              onValueChange={(next) => {
                setPortionType(next);
                setAmount(null);
              }}
              segments={[
                { value: "percent", label: "% of quote" },
                { value: "amount", label: "Amount" },
              ]}
            />
            {portionType === "percent" ? (
              <TextField
                label="Percentage"
                name="portionPercent"
                inputMode="decimal"
                defaultValue="30"
                onChange={(e) => {
                  const bp = parseMoneyToCents(e.target.value.replace(/%$/, ""));
                  setAmount(bp);
                }}
                className="text-right tabular"
              />
            ) : (
              <MoneyField label="Amount before tax" value={amount} onValueChange={setAmount} />
            )}
            <input
              type="hidden"
              name="portionValue"
              value={portionType === "percent" ? String(amount ?? 3000) : String(amount ?? 0)}
            />
            <Button type="submit" loading={creating("progress")}>
              Create progress invoice
            </Button>
          </Form>
        ) : (
          <Button type="button" variant="secondary" onClick={() => setProgress(true)}>
            <Receipt aria-hidden />
            Progress invoice
          </Button>
        )}
        {!has("final") && createButton("final", "Final invoice")}
        {live.length === 0 && createButton("full", "Invoice in full")}
      </div>
    </Card>
  );
}

/** Automatic follow-ups while the client hasn't answered (SPEC 5.9). */
function FollowUpsCard({ paused, busy }: { paused: boolean; busy: (intent: string) => boolean }) {
  return (
    <Card data-testid="follow-ups">
      <h2 className="flex items-center gap-2 font-display text-title">
        {paused ? (
          <BellOff className="size-5 text-saffron-ink" aria-hidden />
        ) : (
          <BellRing className="size-5 text-sage-ink" aria-hidden />
        )}
        Follow-ups {paused ? "paused" : "on"}
      </h2>
      <p className="mt-1 text-label text-secondary">
        {paused
          ? "The client won't get automatic follow-up emails about this quote."
          : "If the client hasn't answered, a friendly follow-up goes at 8 a.m. on the days set in Settings → Reminders."}
      </p>
      <Form method="post" className="mt-3">
        <input type="hidden" name="intent" value={paused ? "resume_follow_ups" : "pause_follow_ups"} />
        <Button
          type="submit"
          variant="secondary"
          className="w-full"
          loading={busy("pause_follow_ups") || busy("resume_follow_ups")}
        >
          {paused ? <BellRing aria-hidden /> : <BellOff aria-hidden />}
          {paused ? "Resume follow-ups" : "Pause follow-ups"}
        </Button>
      </Form>
    </Card>
  );
}

function ApprovalCard({
  acceptance,
  projectId,
}: {
  acceptance: NonNullable<NonNullable<LoaderData["history"]>["acceptance"]>;
  projectId: string | null;
}) {
  return (
    <Card className="border-sage-base">
      <h2 className="flex items-center gap-2 font-display text-title">
        <Check className="size-5 text-sage-ink" aria-hidden />
        Approved
      </h2>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-label">
        <dt className="text-secondary">By</dt>
        <dd className="font-semibold">{acceptance.signerName}</dd>
        <dt className="text-secondary">On</dt>
        <dd>{relativeTime(acceptance.acceptedAt)}</dd>
        <dt className="text-secondary">Total</dt>
        <dd className="font-semibold tabular">{formatCents(acceptance.acceptedTotalCents)}</dd>
        {acceptance.selectedOptionLineIds.length > 0 && (
          <>
            <dt className="text-secondary">Options</dt>
            <dd>{acceptance.selectedOptionLineIds.length} chosen</dd>
          </>
        )}
        <dt className="text-secondary">Revision</dt>
        <dd>{acceptance.revisionNo}</dd>
      </dl>
      {acceptance.signatureSvg && (
        <img
          src={`data:image/svg+xml;utf8,${encodeURIComponent(acceptance.signatureSvg)}`}
          alt={`Signature of ${acceptance.signerName}`}
          className="mt-3 w-full rounded-control border border-border bg-surface"
        />
      )}
      {projectId && (
        <Button asChild variant="secondary" className="mt-4 w-full">
          <Link to={`/projects/${projectId}`}>
            <FolderOpen aria-hidden />
            Open the project
          </Link>
        </Button>
      )}
    </Card>
  );
}

function Builder({ data }: { data: LoaderData }) {
  const initial: Draft = {
    header: {
      title: data.quote.title,
      clientId: data.quote.clientId,
      siteId: data.quote.siteId,
      validUntil: data.quote.validUntil,
      depositType: data.quote.depositType,
      depositValue: data.quote.depositValue,
    },
    sections: data.content.sections,
    documentDiscount: data.content.documentDiscount,
    notes: data.content.notes,
    terms: data.content.terms,
  };
  const { draft, dispatch, status, conflict, overwrite, retry, dirty, version, saveNow } = useDraft({
    endpoint: `/api/quotes/${data.quote.id}/draft`,
    initial,
    version: data.quote.draftVersion,
    savedAt: data.quote.updatedAt,
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
  const navigation = useNavigation();
  const revalidator = useRevalidator();

  const props = previewProps(data, draft, client, site);
  const actionData = useActionData<typeof action>();
  const sameClient = !!data.client && draft.header.clientId === data.client.id;
  const depositLabel =
    draft.header.depositType === "percent" && draft.header.depositValue !== null
      ? `${formatBp(draft.header.depositValue)}%`
      : undefined;

  const header = (
    <HeaderFields
      draft={draft}
      dispatch={dispatch}
      onClient={(name) => setClient(name ? { name, company: null, address: "", email: null } : null)}
      onSite={setSite}
      defaultDepositBp={data.sendSetup?.defaultDepositBp ?? 8500}
    />
  );

  return (
    <div className="flex flex-col gap-4 pb-24 wide:pb-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <BackLink />
        {data.quote.number && <span className="font-display text-section">{data.quote.number}</span>}
        <StatusBadge status="draft" />
        <SaveStatus status={status} className="min-h-11" />
        {status.state === "error" && !conflict && (
          <Button type="button" variant="secondary" onClick={() => void retry()}>
            <RefreshCw aria-hidden />
            Retry
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          {!data.revising && (
            <Form method="post">
              <input type="hidden" name="intent" value="duplicate" />
              <Button
                type="submit"
                variant="ghost"
                loading={navigation.formData?.get("intent") === "duplicate"}
                disabled={dirty}
              >
                <Copy aria-hidden />
                <span className="sr-only tablet:not-sr-only">Duplicate</span>
              </Button>
            </Form>
          )}
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
              // A client picked or created in this session: load their email for "To".
              if (draft.header.clientId && draft.header.clientId !== data.client?.id) {
                void revalidator.revalidate();
              }
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
                Revising {data.quote.number} (rev {data.revising.revisionNo + 1}).
              </span>{" "}
              The client still sees rev {data.revising.revisionNo} and can't approve it until you send this
              revision or discard your changes.
            </p>
            <RevisionRequests thread={data.thread} noun="quote" />
          </div>
          {data.thread && <ConversationButton thread={data.thread} onOpen={() => setTalking(true)} />}
        </div>
      )}
      {data.thread && (
        <ConversationSheet
          open={talking}
          onOpenChange={setTalking}
          entity="quote"
          entityId={data.quote.id}
          thread={data.thread}
          clientName={data.client?.name ?? null}
          canHide={data.isOwner}
          dirty={dirty}
        />
      )}

      <BuilderWorkspace
        noun="quote"
        header={header}
        sections={draft.sections}
        documentDiscount={draft.documentDiscount}
        notes={draft.notes}
        terms={draft.terms}
        dispatch={dispatch}
        totals={props.totals}
        taxRates={data.content.taxRates}
        depositLabel={depositLabel}
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
        noun="quote"
        revision={data.revising ? data.revising.revisionNo + 1 : 1}
        number={data.quote.number}
        nextNumber={data.sendSetup?.nextNumber ?? null}
        wording={data.sendSetup?.wording}
        values={{
          "client.firstName": (sameClient ? data.client!.name : "there").split(/s+/)[0],
          "client.name": sameClient ? data.client!.name : "",
          "business.name": data.business.name,
          "quote.number": data.quote.number ?? data.sendSetup?.nextNumber ?? "",
          "amount.total": formatCents(props.totals.computed.totalCents),
          link: "(link to the quote)",
        }}
        revisedSubject={`Revised quote ${data.quote.number} (rev ${(data.revising?.revisionNo ?? 0) + 1}) from ${data.business.name}`}
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
                  : !draft.header.validUntil
                    ? "Set a valid-until date first."
                    : draft.header.validUntil < data.today
                      ? "The valid-until date has passed; choose a later date."
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
            ? "Your changes are thrown away and the quote goes back to the version the client has."
            : "Drafts have no number yet, so nothing is lost from your numbering. This can't be undone."
        }
        confirmLabel={revising ? "Discard changes" : "Delete draft"}
        destructive
        onConfirm={() => formRef.current?.requestSubmit()}
      />
    </>
  );
}

function HeaderFields({
  draft,
  dispatch,
  onClient,
  onSite,
  defaultDepositBp,
}: {
  draft: Draft;
  dispatch: (action: DraftAction) => void;
  onClient: (name: string | null) => void;
  onSite: (site: { label: string; address: string } | null) => void;
  defaultDepositBp: number;
}) {
  const { header } = draft;
  return (
    <Card>
      <h2 className="mb-4 font-display text-title">Details</h2>
      <div className="grid gap-4 tablet:grid-cols-2 [&>*]:min-w-0">
        <ClientCombobox
          name="builder-client"
          defaultValue={header.clientId}
          onChange={(clientId, name) => {
            dispatch({ type: "header", patch: { clientId, siteId: null } });
            onClient(name);
            onSite(null);
          }}
        />
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
        <DateField
          label="Valid until"
          value={header.validUntil ?? ""}
          onChange={(e) => dispatch({ type: "header", patch: { validUntil: e.target.value || null } })}
        />
        <DepositField draft={draft} dispatch={dispatch} defaultBp={defaultDepositBp} />
      </div>
    </Card>
  );
}

function DepositField({
  draft,
  dispatch,
  defaultBp,
}: {
  draft: Draft;
  dispatch: (action: DraftAction) => void;
  defaultBp: number;
}) {
  const { depositType, depositValue } = draft.header;
  const mode = depositType ?? "none";
  return (
    <div className="flex flex-col gap-2 tablet:col-span-2">
      <span className="text-label font-semibold">Deposit</span>
      <SegmentedControl
        label="Deposit terms"
        value={mode}
        onValueChange={(next) =>
          dispatch({
            type: "header",
            patch:
              next === "none"
                ? { depositType: null, depositValue: null }
                : next === "percent"
                  ? { depositType: "percent", depositValue: defaultBp }
                  : { depositType: "amount", depositValue: 0 },
          })
        }
        segments={[
          { value: "none", label: "None" },
          { value: "percent", label: "% of total" },
          { value: "amount", label: "Fixed amount" },
        ]}
      />
      {depositType === "percent" && (
        <TextField
          label="Deposit (%)"
          inputMode="decimal"
          defaultValue={depositValue !== null ? formatBp(depositValue) : ""}
          key={`pct-${depositValue}`}
          onBlur={(e) => {
            const bp = parseMoneyToCents(e.target.value.replace(/%$/, ""));
            if (bp !== null)
              dispatch({ type: "header", patch: { depositValue: Math.min(10_000, Math.max(0, bp)) } });
          }}
          fieldClassName="max-w-40"
          className="text-right tabular"
        />
      )}
      {depositType === "amount" && (
        <div className="max-w-56">
          <MoneyField
            label="Deposit amount"
            value={depositValue}
            onValueChange={(v) => dispatch({ type: "header", patch: { depositValue: v ?? 0 } })}
          />
        </div>
      )}
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };

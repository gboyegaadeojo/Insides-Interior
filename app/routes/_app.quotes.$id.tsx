import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  CalendarPlus,
  Check,
  ChevronLeft,
  ClipboardCopy,
  Copy,
  FileDown,
  FolderOpen,
  Mail,
  PencilLine,
  Plus,
  RefreshCw,
  Send,
  Share2,
  Trash2,
  Undo2,
} from "lucide-react";
import * as React from "react";
import {
  data,
  Form,
  Link,
  redirect,
  useActionData,
  useBlocker,
  useNavigation,
  useRevalidator,
} from "react-router";
import { DocumentRenderer, type DocumentRendererProps } from "~/components/doc/document-renderer";
import { Paper } from "~/components/doc/paper";
import { RouteErrorBoundary } from "~/components/shell/route-error";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { DateField, TextField, Textarea } from "~/components/ui/field";
import { MoneyField } from "~/components/ui/number-fields";
import { SaveStatus } from "~/components/ui/save-status";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { Sheet, SheetContent } from "~/components/ui/sheet";
import { StatusBadge } from "~/components/ui/status-badge";
import { toast } from "~/components/ui/toast";
import { computeContent, depositFrom } from "~/domain/document";
import { canQuote } from "~/domain/lifecycle";
import { formatBp, formatCents, parseMoneyToCents } from "~/domain/money";
import { applySelection, isPastValidUntil } from "~/domain/portal";
import { ClientCombobox } from "~/features/clients/ui/client-combobox";
import { formatAddress } from "~/features/clients/service";
import { listTemplates } from "~/features/catalogue/service";
import { SiteSelect } from "~/features/projects/ui/site-select";
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
} from "~/features/quotes/service";
import { type BuilderItem, CatalogueSheet } from "~/features/quotes/ui/catalogue-sheet";
import { SectionCard, useDragSensors } from "~/features/quotes/ui/section-card";
import { TotalBar, TotalsBreakdown } from "~/features/quotes/ui/totals";
import { type Draft, type DraftAction, useDraft } from "~/features/quotes/ui/use-draft";
import { loadDocBusiness } from "~/features/settings/doc-business";
import { activeTaxRates, ServiceError } from "~/features/settings/service";
import { activityLabel, relativeTime } from "~/lib/activity-label";
import { businessToday, formatDate } from "~/lib/dates";
import { renderMergeFields } from "~/lib/merge-fields";
import type { AppHandle } from "~/lib/route-handle";
import { cn } from "~/lib/utils";
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
  const [business, items, templates, rates, history, setup, shareUrl] = await Promise.all([
    loadDocBusiness(ctx.db, ctx.user.businessId),
    isDraft ? builderCatalogue(ctx) : [],
    isDraft ? listTemplates(ctx) : [],
    isDraft ? activeTaxRates(ctx) : [],
    detail.quote.number ? quoteHistory(ctx, params.id) : null,
    isDraft ? sendSetup(ctx) : null,
    detail.quote.shareTokenSalt ? quoteShareUrl(ctx.env, params.id, detail.quote.shareTokenSalt) : null,
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
  return {
    quote,
    content: detail.content,
    revisionNo: detail.revisionNo,
    revising: detail.revising,
    history,
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
        return redirect("/quotes?status=draft");
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
      case "retry_email":
        await retryQuoteEmail(ctx, params.id);
        return done("Email queued again");
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
  // One toast per action result (sent, revised, extended…).
  React.useEffect(() => {
    if (!actionData) return;
    if (actionData.ok) toast(actionData.message, { tone: "success" });
    else if (actionData.intent !== "send") toast(actionData.error ?? "That didn't work", { tone: "error" });
  }, [actionData]);
  return loaderData.quote.status === "draft" ? (
    <Builder key={`${loaderData.quote.id}-${loaderData.revising?.revisionNo ?? 0}`} data={loaderData} />
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
  props.issuedOn = null;
  props.stamp = data.quote.status === "approved" ? "approved" : null;
  const status = data.quote.status;
  const pastDate = isPastValidUntil(data.quote.validUntil, data.today);
  const canExtend =
    status === "expired" || (pastDate && ["sent", "viewed", "changes_requested"].includes(status));
  const canRevise = canQuote(status, "revise");
  const navigation = useNavigation();
  const busy = (intent: string) =>
    navigation.state !== "idle" && navigation.formData?.get("intent") === intent;

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

      <div className="flex flex-col gap-4 wide:grid wide:grid-cols-[minmax(0,1fr)_22rem] wide:items-start wide:gap-6">
        <div className="order-2 wide:order-1">
          <Paper className="mx-auto max-w-[816px]">
            <DocumentRenderer {...props} />
          </Paper>
        </div>
        <div className="order-1 flex flex-col gap-4 wide:order-2">
          {acceptance && <ApprovalCard acceptance={acceptance} projectId={data.quote.projectId} />}
          {data.shareUrl && <ClientLinkCard url={data.shareUrl} busy={busy("rotate_link")} />}
          {data.history && <HistoryCard history={data.history} retrying={busy("retry_email")} />}
        </div>
      </div>
    </div>
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

const noSubscribe = () => () => {};

function ClientLinkCard({ url, busy }: { url: string; busy: boolean }) {
  const [confirm, setConfirm] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);
  const canShare = React.useSyncExternalStore(
    noSubscribe,
    () => typeof navigator.share === "function",
    () => false,
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied", { tone: "success" });
    } catch {
      toast("Couldn't copy; select the link and copy it", { tone: "error" });
    }
  }
  return (
    <Card>
      <h2 className="font-display text-title">Client link</h2>
      <p className="mt-1 text-label text-secondary">
        Anyone with this link can view and approve the quote. Share it by WhatsApp or text if email is slow.
      </p>
      <TextField
        label="Link"
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        fieldClassName="mt-3"
        className="text-label"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={copy}>
          <ClipboardCopy aria-hidden />
          Copy link
        </Button>
        {canShare && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => void navigator.share({ url }).catch(() => {})}
          >
            <Share2 aria-hidden />
            Share
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={() => setConfirm(true)} loading={busy}>
          <RefreshCw aria-hidden />
          New link
        </Button>
      </div>
      <Form method="post" ref={formRef} className="hidden">
        <input type="hidden" name="intent" value="rotate_link" />
      </Form>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Make a new link?"
        description="The current link stops working at once. Use this if the link went to the wrong person."
        confirmLabel="Make a new link"
        destructive
        onConfirm={() => formRef.current?.requestSubmit()}
      />
    </Card>
  );
}

const EMAIL_LABEL: Record<string, string> = {
  quote_sent: "Quote sent",
  quote_revised: "Revision sent",
  quote_approved_client: "Approval receipt to client",
  quote_approved_owner: "Approval notice",
  quote_changes_requested_owner: "Change request notice",
};

const EMAIL_STATUS: Record<string, { label: string; tone: string }> = {
  queued: { label: "Sending", tone: "text-secondary" },
  sent: { label: "Sent", tone: "text-indigo-ink" },
  delivered: { label: "Delivered", tone: "text-teal-ink" },
  opened: { label: "Opened", tone: "text-sage-ink" },
  bounced: { label: "Bounced", tone: "text-danger-ink" },
  complained: { label: "Marked as spam", tone: "text-danger-ink" },
  failed: { label: "Failed", tone: "text-danger-ink" },
};

function HistoryCard({
  history,
  retrying,
}: {
  history: NonNullable<LoaderData["history"]>;
  retrying: boolean;
}) {
  const latest = history.emails.find((e) => e.template === "quote_sent" || e.template === "quote_revised");
  const stuck = latest?.stuck;
  return (
    <Card>
      <h2 className="font-display text-title">History</h2>
      {history.emails.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2" aria-label="Emails">
          {history.emails.map((email) => {
            const s = EMAIL_STATUS[email.status] ?? EMAIL_STATUS.queued!;
            return (
              <li key={email.id} className="flex items-start gap-3 rounded-control bg-surface-2 p-3">
                <Mail className="mt-0.5 size-4.5 shrink-0 text-secondary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{EMAIL_LABEL[email.template] ?? email.template}</p>
                  <p className="truncate text-label text-secondary">to {email.to}</p>
                  {email.error && <p className="text-label text-danger-ink">{email.error}</p>}
                </div>
                <span className={cn("text-label font-semibold", s.tone)}>{s.label}</span>
              </li>
            );
          })}
        </ul>
      )}
      {stuck && (
        <Form method="post" className="mt-3">
          <input type="hidden" name="intent" value="retry_email" />
          <Button type="submit" variant="secondary" className="w-full" loading={retrying}>
            <RefreshCw aria-hidden />
            Retry the email
          </Button>
        </Form>
      )}
      <ol className="mt-4 flex flex-col gap-2 border-t border-border pt-4" aria-label="Activity">
        {history.events.map((event) => (
          <li key={event.id} className="flex items-baseline justify-between gap-3 text-label">
            <span>{activityLabel(event.action, event.data)}</span>
            <time dateTime={event.at} className="shrink-0 text-secondary">
              {relativeTime(event.at)}
            </time>
          </li>
        ))}
      </ol>
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
    quoteId: data.quote.id,
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
  const [view, setView] = React.useState<"edit" | "preview">("edit");
  const [addingTo, setAddingTo] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const sensors = useDragSensors();
  const navigation = useNavigation();
  const revalidator = useRevalidator();

  const props = previewProps(data, draft, client, site);
  const depositLabel =
    draft.header.depositType === "percent" && draft.header.depositValue !== null
      ? `${formatBp(draft.header.depositValue)}%`
      : undefined;

  // Leave-page confirmation unless the draft is safely saved (SPEC 6.8 builder).
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function onSectionDragEnd(event: DragEndEvent) {
    const from = draft.sections.findIndex((s) => s.id === event.active.id);
    const to = draft.sections.findIndex((s) => s.id === event.over?.id);
    if (from >= 0 && to >= 0) dispatch({ type: "moveSection", from, to });
  }

  const editor = (
    <div className="flex flex-col gap-4">
      <HeaderFields
        draft={draft}
        dispatch={dispatch}
        onClient={(name) => setClient(name ? { name, company: null, address: "", email: null } : null)}
        onSite={setSite}
      />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onSectionDragEnd}>
        <SortableContext items={draft.sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-4">
            {draft.sections.map((section, i) => (
              <SectionCard
                key={section.id}
                section={section}
                index={i}
                count={draft.sections.length}
                totals={props.totals}
                taxRates={data.content.taxRates}
                dispatch={dispatch}
                onAddLine={setAddingTo}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <Button
        type="button"
        variant="tinted"
        size="lg"
        className="border-dashed border-tertiary/60 text-secondary hover:text-primary"
        onClick={() =>
          dispatch({
            type: "addSection",
            section: { id: crypto.randomUUID(), title: `Room ${draft.sections.length + 1}`, lines: [] },
          })
        }
      >
        <Plus aria-hidden />
        Add room
      </Button>
      <DocumentDiscountField draft={draft} dispatch={dispatch} />
      <Card>
        <h2 className="mb-4 font-display text-title">Notes and terms</h2>
        <div className="flex flex-col gap-4">
          <Textarea
            label="Notes"
            value={draft.notes ?? ""}
            onChange={(e) => dispatch({ type: "text", field: "notes", value: e.target.value })}
            hint="Lead times, what's included"
          />
          <Textarea
            label="Terms"
            value={draft.terms ?? ""}
            onChange={(e) => dispatch({ type: "text", field: "terms", value: e.target.value })}
            className="min-h-32"
          />
        </div>
      </Card>
      <Card>
        <h2 className="mb-3 font-display text-title">Totals</h2>
        <TotalsBreakdown totals={props.totals} depositLabel={depositLabel} />
      </Card>
    </div>
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
          className="flex items-start gap-3 rounded-card border border-indigo-base bg-indigo-tint p-4 text-indigo-ink"
        >
          <PencilLine className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p>
            <span className="font-semibold">
              Revising {data.quote.number} (rev {data.revising.revisionNo + 1}).
            </span>{" "}
            The client still sees rev {data.revising.revisionNo} and can't approve it until you send this
            revision or discard your changes.
          </p>
        </div>
      )}

      {conflict && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-card border border-saffron-base bg-saffron-tint p-4 text-saffron-ink tablet:flex-row tablet:items-center"
        >
          <p className="flex-1 font-semibold">
            A newer version of this quote was saved in another tab or device. Your latest changes aren't
            saved.
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => revalidator.revalidate().then(() => window.location.reload())}
          >
            Load the newer version
          </Button>
          <Button type="button" onClick={overwrite}>
            Keep mine
          </Button>
        </div>
      )}

      <SegmentedControl
        label="Edit or preview"
        className="wide:hidden"
        value={view}
        onValueChange={setView}
        segments={[
          { value: "edit", label: "Edit" },
          { value: "preview", label: "Preview" },
        ]}
      />

      {/* Tablet landscape 58/42 keeps room to edit; desktop splits evenly so the preview stays legible. */}
      <div className="wide:grid wide:grid-cols-[minmax(0,58fr)_minmax(0,42fr)] wide:items-start wide:gap-6 desktop:grid-cols-2">
        <div className={cn(view === "preview" && "hidden wide:block")}>{editor}</div>
        <aside
          aria-label="Live preview"
          className={cn(
            "rounded-sheet border border-border bg-surface-2 p-3 tablet:p-5 wide:sticky wide:top-20 desktop:p-4",
            view === "edit" && "hidden wide:block",
          )}
        >
          <Paper>
            <DocumentRenderer {...props} />
          </Paper>
        </aside>
      </div>

      <TotalBar totals={props.totals} depositLabel={depositLabel} />

      <CatalogueSheet
        open={addingTo !== null}
        onOpenChange={(open) => !open && setAddingTo(null)}
        items={data.items}
        templates={data.templates}
        defaultTaxIds={data.defaultTaxIds}
        onAddLines={(lines) => addingTo && dispatch({ type: "addLines", sectionId: addingTo, lines })}
        onAddSection={(section) => dispatch({ type: "addSection", section })}
      />
      <ConfirmDialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => !open && blocker.state === "blocked" && blocker.reset()}
        title="Leave before it's saved?"
        description="Your latest changes to this quote haven't been saved yet."
        confirmLabel="Leave anyway"
        cancelLabel="Stay"
        destructive
        onConfirm={() => {
          if (blocker.state === "blocked") blocker.proceed();
        }}
      />
      <DeleteDraftDialog open={confirmDelete} onOpenChange={setConfirmDelete} revising={!!data.revising} />
      <SendSheet
        open={sending}
        onOpenChange={setSending}
        data={data}
        draft={draft}
        totals={props.totals}
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

/**
 * FR-QT-08: send with the PDF attached and the portal link; CC/BCC; preview of
 * the email before it goes. The button waits for autosave so the server sends
 * exactly what's on screen, and is disabled while sending.
 */
function SendSheet({
  open,
  onOpenChange,
  data,
  draft,
  totals,
  version,
  saving,
  blocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: LoaderData;
  draft: Draft;
  totals: DocumentRendererProps["totals"];
  version: number;
  saving: boolean;
  blocked: string | null;
}) {
  const navigation = useNavigation();
  const actionData = useActionData<typeof action>();
  const sendingNow = navigation.state !== "idle" && navigation.formData?.get("intent") === "send";
  const error = actionData && !actionData.ok && actionData.intent === "send" ? actionData : null;
  const [copies, setCopies] = React.useState(false);
  const formId = React.useId();
  const sameClient = data.client && draft.header.clientId === data.client.id;
  const revision = data.revising ? data.revising.revisionNo + 1 : 1;
  const number = data.quote.number ?? data.sendSetup?.nextNumber ?? "your next number";
  const wording = data.sendSetup?.wording;
  const values = {
    "client.firstName": (sameClient ? data.client!.name : "there").split(/\s+/)[0],
    "client.name": sameClient ? data.client!.name : "",
    "business.name": data.business.name,
    "quote.number": number,
    "amount.total": formatCents(totals.computed.totalCents),
    link: "(link to the quote)",
  };
  const subject =
    revision > 1
      ? `Revised quote ${number} (rev ${revision}) from ${data.business.name}`
      : wording
        ? renderMergeFields(wording.subject, values)
        : "";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={revision > 1 ? `Send revision ${revision}` : "Send quote"}
        description={
          data.quote.number
            ? `${data.quote.number} goes out with its PDF and a link to view and approve.`
            : `It gets its number when it's sent, most likely ${number}.`
        }
        footer={
          <div className="flex flex-col gap-2">
            {(blocked || saving) && (
              <p className="text-label font-semibold text-secondary" role="status">
                {blocked ?? "Saving your latest changes…"}
              </p>
            )}
            <Button
              type="submit"
              form={formId}
              size="lg"
              className="w-full"
              loading={sendingNow}
              disabled={!!blocked || saving}
            >
              <Send aria-hidden />
              Send {formatCents(totals.computed.totalCents)}
            </Button>
          </div>
        }
      >
        <Form method="post" id={formId} className="flex flex-col gap-5">
          <input type="hidden" name="intent" value="send" />
          <input type="hidden" name="version" value={version} />
          {error?.error && error.field !== "to" && error.field !== "cc" && error.field !== "bcc" && (
            <p
              role="alert"
              className="rounded-card border border-danger-base bg-danger-tint p-3 font-semibold text-danger-ink"
            >
              {error.error}
            </p>
          )}
          {sameClient && data.client!.emailBounced && (
            <p
              role="alert"
              className="rounded-card border border-saffron-base bg-saffron-tint p-3 text-saffron-ink"
            >
              <span className="font-semibold">The last email to {data.client!.email} bounced.</span> Check the
              address before sending.
            </p>
          )}
          <TextField
            key={sameClient ? data.client!.id : "other"}
            label="To"
            name="to"
            type="email"
            required
            autoComplete="off"
            defaultValue={sameClient ? (data.client!.email ?? "") : ""}
            error={error?.field === "to" ? (error.error ?? undefined) : undefined}
            hint={sameClient && !data.client!.email ? "This client has no email saved yet" : undefined}
          />
          {copies ? (
            <>
              <TextField
                label="CC"
                name="cc"
                autoComplete="off"
                hint="Separate addresses with commas"
                error={error?.field === "cc" ? (error.error ?? undefined) : undefined}
              />
              <TextField
                label="BCC"
                name="bcc"
                autoComplete="off"
                hint="Separate addresses with commas"
                error={error?.field === "bcc" ? (error.error ?? undefined) : undefined}
              />
            </>
          ) : (
            <Button type="button" variant="ghost" className="self-start" onClick={() => setCopies(true)}>
              <Plus aria-hidden />
              Add CC or BCC
            </Button>
          )}
          <Textarea
            label="Personal note (optional)"
            name="note"
            maxLength={2000}
            hint="Shown in the email above the quote details"
          />
          {wording && (
            <section
              aria-label="Email preview"
              className="rounded-card border border-border bg-surface-2 p-4"
            >
              <p className="text-micro font-semibold tracking-[0.08em] text-secondary uppercase">
                Email preview
              </p>
              <p className="mt-2 font-semibold">{subject}</p>
              <div className="mt-2 flex flex-col gap-2 text-label text-secondary">
                {renderMergeFields(wording.body, values)
                  .split(/\n\s*\n/)
                  .filter(Boolean)
                  .map((p) => (
                    <p key={p} className="whitespace-pre-line">
                      {p}
                    </p>
                  ))}
              </div>
              <p className="mt-3 text-micro text-secondary">
                Change this wording in Settings → Email. The PDF is attached.
              </p>
            </section>
          )}
        </Form>
      </SheetContent>
    </Sheet>
  );
}

function HeaderFields({
  draft,
  dispatch,
  onClient,
  onSite,
}: {
  draft: Draft;
  dispatch: (action: DraftAction) => void;
  onClient: (name: string | null) => void;
  onSite: (site: { label: string; address: string } | null) => void;
}) {
  const { header } = draft;
  return (
    <Card>
      <h2 className="mb-4 font-display text-title">Details</h2>
      <div className="grid gap-4 tablet:grid-cols-2">
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
        <DepositField draft={draft} dispatch={dispatch} />
      </div>
    </Card>
  );
}

function DepositField({ draft, dispatch }: { draft: Draft; dispatch: (action: DraftAction) => void }) {
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
                  ? { depositType: "percent", depositValue: 5000 }
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

function DocumentDiscountField({
  draft,
  dispatch,
}: {
  draft: Draft;
  dispatch: (action: DraftAction) => void;
}) {
  const discount = draft.documentDiscount;
  return (
    <Card>
      <h2 className="mb-4 font-display text-title">Discount on the whole quote</h2>
      <div className="flex flex-col gap-2">
        <SegmentedControl
          label="Document discount"
          value={discount?.type ?? "none"}
          onValueChange={(mode) =>
            dispatch({
              type: "documentDiscount",
              discount:
                mode === "none"
                  ? undefined
                  : mode === "percent"
                    ? { type: "percent", bp: 1000 }
                    : { type: "amount", cents: 0 },
            })
          }
          segments={[
            { value: "none", label: "None" },
            { value: "percent", label: "%" },
            { value: "amount", label: "₦" },
          ]}
        />
        {discount?.type === "percent" && (
          <TextField
            label="Discount (%)"
            inputMode="decimal"
            defaultValue={formatBp(discount.bp)}
            key={`dd-${discount.bp}`}
            onBlur={(e) => {
              const bp = parseMoneyToCents(e.target.value.replace(/%$/, ""));
              if (bp !== null)
                dispatch({
                  type: "documentDiscount",
                  discount: { type: "percent", bp: Math.min(10_000, Math.max(0, bp)) },
                });
            }}
            fieldClassName="max-w-40"
            className="text-right tabular"
            hint="Shared across lines before tax"
          />
        )}
        {discount?.type === "amount" && (
          <div className="max-w-56">
            <MoneyField
              label="Discount"
              value={discount.cents}
              onValueChange={(v) =>
                dispatch({ type: "documentDiscount", discount: { type: "amount", cents: v ?? 0 } })
              }
              hint="Shared across lines before tax"
            />
          </div>
        )}
      </div>
    </Card>
  );
}

export { RouteErrorBoundary as ErrorBoundary };

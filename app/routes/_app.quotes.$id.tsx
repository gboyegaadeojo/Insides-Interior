import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ChevronLeft, Copy, Plus, RefreshCw, Trash2 } from "lucide-react";
import * as React from "react";
import { data, Form, Link, redirect, useBlocker, useNavigation, useRevalidator } from "react-router";
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
import { StatusBadge } from "~/components/ui/status-badge";
import { computeContent, depositFrom } from "~/domain/document";
import { formatBp, parseMoneyToCents } from "~/domain/money";
import { ClientCombobox } from "~/features/clients/ui/client-combobox";
import { formatAddress } from "~/features/clients/service";
import { listTemplates } from "~/features/catalogue/service";
import { SiteSelect } from "~/features/projects/ui/site-select";
import { builderCatalogue, deleteDraft, duplicateQuote, getQuote } from "~/features/quotes/service";
import { type BuilderItem, CatalogueSheet } from "~/features/quotes/ui/catalogue-sheet";
import { SectionCard, useDragSensors } from "~/features/quotes/ui/section-card";
import { TotalBar, TotalsBreakdown } from "~/features/quotes/ui/totals";
import { type Draft, type DraftAction, useDraft } from "~/features/quotes/ui/use-draft";
import { loadDocBusiness } from "~/features/settings/doc-business";
import { activeTaxRates, ServiceError } from "~/features/settings/service";
import { businessToday } from "~/lib/dates";
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
  const [business, items, templates, rates] = await Promise.all([
    loadDocBusiness(ctx.db, ctx.user.businessId),
    builderCatalogue(ctx),
    listTemplates(ctx),
    activeTaxRates(ctx),
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
  return {
    quote: detail.quote,
    content: detail.content,
    revisionNo: detail.revisionNo,
    client: detail.client
      ? {
          id: detail.client.id,
          name: detail.client.displayName,
          company: detail.client.company,
          address: formatAddress(detail.client.billingAddress),
          email: detail.client.email,
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
  const intent = (await request.formData()).get("intent");
  try {
    if (intent === "duplicate") return redirect(`/quotes/${await duplicateQuote(ctx, params.id)}`);
    if (intent === "delete") {
      await deleteDraft(ctx, params.id);
      return redirect("/quotes?status=draft");
    }
  } catch (error) {
    if (error instanceof ServiceError) return data({ error: error.message }, { status: 400 });
    throw error;
  }
  throw new Response("Unknown action", { status: 400 });
}

type LoaderData = Route.ComponentProps["loaderData"];

export default function QuoteScreen({ loaderData }: Route.ComponentProps) {
  return loaderData.quote.status === "draft" ? (
    <Builder key={loaderData.quote.id} data={loaderData} />
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
      ...data.content,
    },
    data.client,
    data.site,
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <BackLink />
        <span className="font-display text-section">{data.quote.number}</span>
        <StatusBadge status={data.quote.status} revision={data.revisionNo ?? undefined} />
      </div>
      <Paper className="mx-auto max-w-[816px]">
        <DocumentRenderer {...props} />
      </Paper>
    </div>
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
  const { draft, dispatch, status, conflict, overwrite, retry, dirty } = useDraft({
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
          <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)}>
            <Trash2 aria-hidden />
            <span className="sr-only tablet:not-sr-only">Delete draft</span>
          </Button>
        </div>
      </div>

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
      <DeleteDraftDialog open={confirmDelete} onOpenChange={setConfirmDelete} />
    </div>
  );
}

function DeleteDraftDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const formRef = React.useRef<HTMLFormElement>(null);
  return (
    <>
      <Form method="post" ref={formRef} className="hidden">
        <input type="hidden" name="intent" value="delete" />
      </Form>
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Delete this draft?"
        description="Drafts have no number yet, so nothing is lost from your numbering. This can't be undone."
        confirmLabel="Delete draft"
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

import { BellOff, FileCheck2, Receipt, Search } from "lucide-react";
import * as React from "react";
import {
  Form,
  Link,
  Outlet,
  redirect,
  useActionData,
  useLocation,
  useNavigation,
  useSearchParams,
  useSubmit,
} from "react-router";
import { ModuleHeader } from "~/components/shell/module-header";
import { RouteErrorBoundary } from "~/components/shell/route-error";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { ConfirmDelete } from "~/components/ui/confirm-delete";
import { EmptyState } from "~/components/ui/states";
import { StatusBadge } from "~/components/ui/status-badge";
import { MoneyText } from "~/components/ui/text";
import { percentPaid } from "~/domain/invoice";
import { formatCents } from "~/domain/money";
import {
  INVOICE_FILTER_LABELS,
  INVOICE_FILTERS,
  INVOICE_KIND_LABEL,
  INVOICE_PAGE_SIZE,
  type InvoiceFilter,
} from "~/features/invoices/constants";
import {
  awaitingFinalInvoice,
  createInvoice,
  createInvoiceFromQuote,
  deleteInvoiceDraft,
  listInvoices,
  outstandingSummary,
} from "~/features/invoices/service";
import { ServiceError } from "~/features/settings/service";
import { toast } from "~/components/ui/toast";
import { InvoiceKindTag } from "~/features/invoices/ui/kind-tag";
import { NewInvoiceButton } from "~/features/invoices/ui/new-invoice-button";
import { businessToday, formatDate } from "~/lib/dates";
import type { AppHandle } from "~/lib/route-handle";
import { assertSameOrigin, requireUser } from "~/server/session";
import type { Route } from "./+types/_app.invoices";

export const handle: AppHandle = { module: "invoices", title: "Invoices" };

export function meta() {
  return [{ title: "Invoices · Insides Interior" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireUser(context.cloudflare.env, request);
  const url = new URL(request.url);
  const filter = (INVOICE_FILTERS.find((f) => f === url.searchParams.get("status")) ??
    "all") as InvoiceFilter;
  const query = url.searchParams.get("q") ?? "";
  const limit = Math.max(INVOICE_PAGE_SIZE, Number(url.searchParams.get("show")) || 0);
  const [{ invoices, counts, hasMore }, summary, readyForFinal] = await Promise.all([
    listInvoices(ctx, { filter, query, limit }),
    outstandingSummary(ctx),
    awaitingFinalInvoice(ctx),
  ]);
  return { invoices, counts, hasMore, limit, filter, query, summary, readyForFinal, today: businessToday() };
}

/** + New invoice: a blank standard invoice (no number until sent, FR-INV-02). */
export async function action({ request, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const ctx = await requireUser(context.cloudflare.env, request);
  const form = await request.formData();
  // Delete an unsent draft from the list (owner request; it always asks first).
  if (form.get("intent") === "delete-draft") {
    await deleteInvoiceDraft(ctx, String(form.get("id")));
    return { ok: true };
  }
  // Ready for final invoice: one tap makes it from the approved quote (owner request).
  if (form.get("intent") === "final-invoice") {
    try {
      const id = await createInvoiceFromQuote(ctx, String(form.get("quoteId")), { kind: "final" });
      return redirect(`/invoices/${id}`);
    } catch (error) {
      if (error instanceof ServiceError) return { ok: false, error: error.message };
      throw error;
    }
  }
  const clientId = form.get("clientId");
  const projectId = form.get("projectId");
  const id = await createInvoice(ctx, {
    clientId: typeof clientId === "string" && clientId ? clientId : null,
    projectId: typeof projectId === "string" && projectId ? projectId : null,
  });
  return redirect(`/invoices/${id}`);
}

export default function Invoices({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const submit = useSubmit();
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const actionData = useActionData<typeof action>();
  React.useEffect(() => {
    if (actionData && "error" in actionData && actionData.error) toast(actionData.error, { tone: "error" });
  }, [actionData]);
  if (pathname !== "/invoices" && pathname !== "/invoices/") return <Outlet />;

  const { invoices, counts, filter, query, summary, readyForFinal } = loaderData;
  return (
    <>
      <ModuleHeader
        eyebrow="Invoices"
        summary={
          counts.all === 0
            ? "No invoices yet"
            : [
                `${formatCents(summary.outstandingCents)} outstanding`,
                `${summary.overdueCount} overdue`,
                `${counts.draft} draft${counts.draft === 1 ? "" : "s"}`,
                readyForFinal.length ? `${readyForFinal.length} ready for final invoice` : null,
              ]
                .filter(Boolean)
                .join(" · ")
        }
        action={<NewInvoiceButton />}
      />
      {filter === "all" && !query && readyForFinal.length > 0 && <ReadyForFinal jobs={readyForFinal} />}
      <div className="mb-4 flex flex-col gap-3">
        <SegmentedControl
          label="Invoice status"
          value={filter}
          onValueChange={(status) => {
            const p = new URLSearchParams(params);
            if (status === "all") p.delete("status");
            else p.set("status", status);
            setParams(p, { preventScrollReset: true });
          }}
          segments={INVOICE_FILTERS.map((f) => ({
            value: f,
            label: INVOICE_FILTER_LABELS[f],
            count: counts[f],
          }))}
        />
        <Form
          method="get"
          role="search"
          onChange={(e) => {
            const form = e.currentTarget;
            clearTimeout(timer.current);
            timer.current = setTimeout(() => submit(form, { replace: true, preventScrollReset: true }), 250);
          }}
        >
          {filter !== "all" && <input type="hidden" name="status" value={filter} />}
          <label className="relative block max-w-xl">
            <span className="sr-only">Search invoices</span>
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-secondary"
              aria-hidden
            />
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Search number, client or title"
              className="h-11 w-full rounded-control border border-tertiary bg-surface pr-3 pl-10 text-body placeholder:text-secondary"
            />
          </label>
        </Form>
      </div>

      {invoices.length === 0 ? (
        counts.all === 0 ? (
          <EmptyState
            icon={Receipt}
            tone="indigo"
            title="No invoices yet"
            description="Make a deposit, progress or final invoice from an approved quote, or start a blank one."
            action={<NewInvoiceButton size="md" />}
          />
        ) : (
          <EmptyState
            icon={Search}
            tone="indigo"
            title="No invoices match"
            description="Try another word or status."
            action={
              <Button asChild variant="secondary">
                <Link to="/invoices">Clear filters</Link>
              </Button>
            }
          />
        )
      ) : (
        <ul
          className="@container divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-card"
          aria-label="Invoices"
        >
          {invoices.map((inv) => {
            const open = !["draft", "paid", "void"].includes(inv.status);
            return (
              <li key={inv.id} className="flex items-center">
                <Link
                  to={`/invoices/${inv.id}`}
                  className="grid min-h-16 min-w-0 flex-1 grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors duration-fast hover:bg-surface-2 @2xl:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_9rem_10rem]"
                >
                  {inv.clientName ? (
                    <Avatar name={inv.clientName} />
                  ) : (
                    <span className="size-9 rounded-full border border-dashed border-tertiary" aria-hidden />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {inv.number ?? "Draft"}
                      <span className="font-normal text-secondary">
                        {" · "}
                        {inv.title || INVOICE_KIND_LABEL[inv.kind]}
                      </span>
                    </span>
                    <span className="block truncate text-label font-normal text-secondary">
                      {inv.clientName ?? "No client yet"}
                    </span>
                  </span>
                  <span className="hidden text-label font-normal text-secondary @2xl:block">
                    {inv.dueDate && open ? `Due ${formatDate(inv.dueDate)}` : ""}
                  </span>
                  <span className="text-right">
                    <MoneyText
                      cents={open ? inv.balanceCents : inv.totalCents}
                      className="block font-semibold"
                    />
                    {open && inv.paidCents > 0 && (
                      <span className="block text-micro text-secondary">
                        of {formatCents(inv.totalCents)}
                      </span>
                    )}
                  </span>
                  <span className="col-span-3 flex flex-wrap items-center gap-1.5 justify-self-start @2xl:col-span-1 @2xl:justify-self-end">
                    <InvoiceKindTag kind={inv.kind} quoteNumber={inv.quoteNumber} depositBp={inv.depositBp} />
                    <StatusBadge
                      status={inv.status}
                      size="sm"
                      percentPaid={percentPaid(inv.totalCents, inv.paidCents)}
                    />
                    {/* FR-AUTO-02: a paused invoice says so in the list. */}
                    {open && inv.remindersPaused && (
                      <span className="inline-flex h-6 items-center gap-1 rounded-full bg-saffron-tint px-2 text-micro font-semibold text-saffron-ink">
                        <BellOff className="size-3.5" aria-hidden />
                        Reminders paused
                      </span>
                    )}
                  </span>
                </Link>
                {inv.status === "draft" && !inv.number && (
                  <ConfirmDelete
                    iconOnly
                    className="mr-2 shrink-0"
                    label="Delete this draft invoice"
                    title="Delete this draft invoice?"
                    description="It hasn't been sent, so nothing reaches the client. This can't be undone."
                    confirmLabel="Delete draft"
                    fields={{ intent: "delete-draft", id: inv.id }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {loaderData.hasMore && (
        <div className="mt-4 flex justify-center">
          <Button asChild variant="secondary">
            <Link
              to={`?${new URLSearchParams({ ...Object.fromEntries(params), show: String(loaderData.limit + INVOICE_PAGE_SIZE) })}`}
              preventScrollReset
              replace
            >
              Show more
            </Link>
          </Button>
        </div>
      )}
    </>
  );
}

type ReadyJob = Route.ComponentProps["loaderData"]["readyForFinal"][number];

/**
 * Jobs with a deposit or progress invoice but no final invoice yet (owner
 * request): when the work is done, one tap bills the rest.
 */
function ReadyForFinal({ jobs }: { jobs: ReadyJob[] }) {
  const [all, setAll] = React.useState(false);
  const shown = all ? jobs : jobs.slice(0, 5);
  const navigation = useNavigation();
  const busyQuote =
    navigation.state !== "idle" && navigation.formData?.get("intent") === "final-invoice"
      ? navigation.formData.get("quoteId")
      : null;
  return (
    <section
      aria-labelledby="ready-for-final"
      className="mb-6 overflow-hidden rounded-card border border-border bg-surface shadow-card"
      data-testid="ready-for-final"
    >
      <header className="flex items-start gap-3 border-b border-border px-4 py-3">
        <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-sage-tint text-sage-ink">
          <FileCheck2 className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id="ready-for-final" className="font-semibold">
            Ready for final invoice
            <span className="ml-2 font-normal text-secondary">{jobs.length}</span>
          </h2>
          <p className="text-label text-secondary">
            Deposit invoiced, final invoice not made yet. When a job is finished, make its final invoice here.
          </p>
        </div>
      </header>
      <ul className="@container divide-y divide-border" aria-label="Ready for final invoice">
        {shown.map((job) => (
          <li
            key={job.id}
            className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 px-4 py-3 @xl:grid-cols-[auto_1fr_auto_auto]"
          >
            <Avatar name={job.clientName ?? "No client"} />
            <Link to={`/quotes/${job.id}`} className="min-w-0 hover:underline">
              <span className="block truncate font-semibold">{job.clientName ?? "No client"}</span>
              <span className="block truncate text-label text-secondary">
                {job.number}
                {job.title ? ` · ${job.title}` : ""} · approved {formatDate(job.approvedAt.slice(0, 10))}
              </span>
            </Link>
            <span className="col-start-2 text-label @xl:col-start-auto @xl:text-right">
              <span className="block font-semibold tabular">
                {formatCents(job.leftToInvoiceCents)} to bill
              </span>
              <span className="block text-secondary tabular">
                {formatCents(job.paidCents)} paid of {formatCents(job.approvedTotalCents)}
              </span>
            </span>
            <Form method="post" className="col-start-2 @xl:col-start-auto">
              <input type="hidden" name="intent" value="final-invoice" />
              <input type="hidden" name="quoteId" value={job.id} />
              <Button type="submit" size="sm" loading={busyQuote === job.id} disabled={!!busyQuote}>
                Final invoice
              </Button>
            </Form>
          </li>
        ))}
      </ul>
      {jobs.length > shown.length && (
        <div className="border-t border-border px-4 py-2">
          <Button variant="ghost" size="sm" onClick={() => setAll(true)}>
            Show all {jobs.length}
          </Button>
        </div>
      )}
    </section>
  );
}

export { RouteErrorBoundary as ErrorBoundary };

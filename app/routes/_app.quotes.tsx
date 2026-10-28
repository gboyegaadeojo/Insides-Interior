import { FileText, Search } from "lucide-react";
import * as React from "react";
import { Form, Link, Outlet, redirect, useLocation, useSearchParams, useSubmit } from "react-router";
import { ModuleHeader } from "~/components/shell/module-header";
import { RouteErrorBoundary } from "~/components/shell/route-error";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { EmptyState } from "~/components/ui/states";
import { StatusBadge } from "~/components/ui/status-badge";
import { MoneyText } from "~/components/ui/text";
import { formatCents } from "~/domain/money";
import { createQuote, listQuotes, QUOTE_FILTERS, type QuoteFilter } from "~/features/quotes/service";
import { NewQuoteButton } from "~/features/quotes/ui/new-quote-button";
import { formatDate } from "~/lib/dates";
import type { AppHandle } from "~/lib/route-handle";
import { assertSameOrigin, requireUser } from "~/server/session";
import type { Route } from "./+types/_app.quotes";

export const handle: AppHandle = { module: "quotes", title: "Quotes" };

export function meta() {
  return [{ title: "Quotes · Insides Interior" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireUser(context.cloudflare.env, request);
  const url = new URL(request.url);
  const filter = (QUOTE_FILTERS.find((f) => f === url.searchParams.get("status")) ?? "all") as QuoteFilter;
  const query = url.searchParams.get("q") ?? "";
  const { quotes, counts } = await listQuotes(ctx, { filter, query });
  const awaiting = (await listQuotes(ctx, { filter: "sent" })).quotes;
  return {
    quotes,
    counts,
    filter,
    query,
    awaitingCount: awaiting.length,
    awaitingCents: awaiting.reduce((s, q) => s + q.totalCents, 0),
  };
}

/** + New quote: creates a draft (no number yet, FR-QT-07) and opens the builder. */
export async function action({ request, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const ctx = await requireUser(context.cloudflare.env, request);
  const form = await request.formData();
  const clientId = form.get("clientId");
  const projectId = form.get("projectId");
  const id = await createQuote(ctx, {
    clientId: typeof clientId === "string" && clientId ? clientId : null,
    projectId: typeof projectId === "string" && projectId ? projectId : null,
  });
  return redirect(`/quotes/${id}`);
}

const LABELS: Record<QuoteFilter, string> = {
  all: "All",
  draft: "Draft",
  sent: "Sent",
  changes_requested: "Changes requested",
  approved: "Approved",
  closed: "Declined / expired",
};

export default function Quotes({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const submit = useSubmit();
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  if (pathname !== "/quotes" && pathname !== "/quotes/") return <Outlet />;

  const { quotes, counts, filter, query } = loaderData;
  return (
    <>
      <ModuleHeader
        eyebrow="Quotes"
        summary={
          counts.all === 0
            ? "No quotes yet"
            : `${loaderData.awaitingCount} awaiting answer · ${formatCents(loaderData.awaitingCents)} out · ${counts.draft} draft${counts.draft === 1 ? "" : "s"}`
        }
        action={<NewQuoteButton />}
      />
      <div className="mb-4 flex flex-col gap-3">
        <SegmentedControl
          label="Quote status"
          value={filter}
          onValueChange={(status) => {
            const p = new URLSearchParams(params);
            if (status === "all") p.delete("status");
            else p.set("status", status);
            setParams(p, { preventScrollReset: true });
          }}
          segments={QUOTE_FILTERS.map((f) => ({ value: f, label: LABELS[f], count: counts[f] }))}
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
            <span className="sr-only">Search quotes</span>
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

      {quotes.length === 0 ? (
        counts.all === 0 ? (
          <EmptyState
            icon={FileText}
            tone="plum"
            title="No quotes yet"
            description="Build a quote room by room, mark optional items, and send it for approval from your iPad."
            action={<NewQuoteButton size="md" />}
          />
        ) : (
          <EmptyState
            icon={Search}
            tone="plum"
            title="No quotes match"
            description="Try another word or status."
            action={
              <Button asChild variant="secondary">
                <Link to="/quotes">Clear filters</Link>
              </Button>
            }
          />
        )
      ) : (
        <ul className="@container flex flex-col gap-2" aria-label="Quotes">
          {quotes.map((q) => (
            <li key={q.id}>
              <Link
                to={`/quotes/${q.id}`}
                className="grid min-h-16 grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 rounded-card border border-border bg-surface px-3 py-2.5 transition-colors duration-fast hover:bg-surface-2 @2xl:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_8rem_9rem]"
              >
                {q.clientName ? (
                  <Avatar name={q.clientName} />
                ) : (
                  <span className="size-9 rounded-full border border-dashed border-tertiary" aria-hidden />
                )}
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    {q.number ?? "Draft"}
                    {q.title && <span className="font-normal text-secondary"> · {q.title}</span>}
                  </span>
                  <span className="block truncate text-label font-normal text-secondary">
                    {q.clientName ?? "No client yet"}
                  </span>
                </span>
                <span className="hidden text-label font-normal text-secondary @2xl:block">
                  {q.validUntil ? `Valid until ${formatDate(q.validUntil)}` : ""}
                </span>
                <MoneyText cents={q.totalCents} className="text-right font-semibold" />
                <span className="col-span-3 justify-self-start @2xl:col-span-1 @2xl:justify-self-end">
                  <StatusBadge status={q.status} size="sm" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export { RouteErrorBoundary as ErrorBoundary };

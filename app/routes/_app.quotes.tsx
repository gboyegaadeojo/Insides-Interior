import { FileText, Search } from "lucide-react";
import * as React from "react";
import { Form, Link, Outlet, redirect, useLocation, useSearchParams, useSubmit } from "react-router";
import { ModuleHeader } from "~/components/shell/module-header";
import { RouteErrorBoundary } from "~/components/shell/route-error";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { ConfirmDelete } from "~/components/ui/confirm-delete";
import { EmptyState } from "~/components/ui/states";
import { MoneyText } from "~/components/ui/text";
import { JOB_FILTER_LABELS, JOB_FILTERS, type JobFilter } from "~/features/jobs/filters";
import { listJobs } from "~/features/jobs/service";
import { JobActionButton, StepBar } from "~/features/jobs/ui/job-steps";
import { QUOTE_PAGE_SIZE } from "~/features/quotes/filters";
import { createQuote, deleteDraft } from "~/features/quotes/service";
import { NewQuoteButton } from "~/features/quotes/ui/new-quote-button";
import { formatDate } from "~/lib/dates";
import { cn } from "~/lib/utils";
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
  // Owner request: jobs by step (Needs you, Waiting on client, Complete, All).
  const filter = (JOB_FILTERS.find((f) => f === url.searchParams.get("step")) ?? "all") as JobFilter;
  const query = url.searchParams.get("q") ?? "";
  const limit = Math.max(QUOTE_PAGE_SIZE, Number(url.searchParams.get("show")) || 0);
  const { jobs, counts, hasMore } = await listJobs(ctx, { filter, query, limit });
  return { jobs, counts, hasMore, limit, filter, query };
}

/** + New quote: creates a draft (no number yet, FR-QT-07) and opens the builder. */
export async function action({ request, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const ctx = await requireUser(context.cloudflare.env, request);
  const form = await request.formData();
  // Delete an unsent draft from the list (owner request; it always asks first).
  if (form.get("intent") === "delete-draft") {
    await deleteDraft(ctx, String(form.get("id")));
    return { ok: true };
  }
  const clientId = form.get("clientId");
  const projectId = form.get("projectId");
  const id = await createQuote(ctx, {
    clientId: typeof clientId === "string" && clientId ? clientId : null,
    projectId: typeof projectId === "string" && projectId ? projectId : null,
  });
  return redirect(`/quotes/${id}`);
}

export default function Quotes({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const submit = useSubmit();
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  if (pathname !== "/quotes" && pathname !== "/quotes/") return <Outlet />;

  const { jobs, counts, filter, query } = loaderData;
  return (
    <>
      <ModuleHeader
        eyebrow="Quotes"
        summary={
          counts.all === 0 && !query
            ? "No quotes yet"
            : `${counts.all} job${counts.all === 1 ? "" : "s"} · ${counts.needs} need${counts.needs === 1 ? "s" : ""} you now`
        }
        action={<NewQuoteButton />}
      />
      <div className="mb-4 flex flex-col gap-3">
        <SegmentedControl
          label="Show"
          value={filter}
          onValueChange={(step) => {
            const p = new URLSearchParams(params);
            if (step === "all") p.delete("step");
            else p.set("step", step);
            p.delete("show");
            setParams(p, { preventScrollReset: true });
          }}
          segments={JOB_FILTERS.map((f) => ({ value: f, label: JOB_FILTER_LABELS[f], count: counts[f] }))}
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
          {filter !== "all" && <input type="hidden" name="step" value={filter} />}
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

      {jobs.length === 0 ? (
        counts.all === 0 && !query ? (
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
        <ul
          className="@container divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-card"
          aria-label="Quotes"
        >
          {jobs.map((q) => (
            <li key={q.id} className="flex items-center gap-2 pr-3">
              <Link
                to={`/quotes/${q.id}`}
                className="grid min-h-16 min-w-0 flex-1 grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors duration-fast hover:bg-surface-2 @3xl:grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1.4fr)_8rem]"
              >
                {q.clientName ? (
                  <Avatar name={q.clientName} />
                ) : (
                  <span className="size-9 rounded-full border border-dashed border-tertiary" aria-hidden />
                )}
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{q.clientName ?? "No client yet"}</span>
                  <span className="block truncate text-label font-normal text-secondary">
                    {q.number ?? "Draft"}
                    {q.title && ` · ${q.title}`}
                  </span>
                </span>
                <span className="col-span-3 min-w-0 @3xl:col-span-1 @3xl:col-start-3 @3xl:row-start-1">
                  <StepBar stage={q.stage} className="max-w-72" />
                  <span
                    className={cn(
                      "mt-1.5 block truncate text-label font-semibold",
                      q.stage.group === "complete"
                        ? "text-sage-ink"
                        : q.stage.action
                          ? "text-accent"
                          : "text-secondary",
                    )}
                    data-testid="job-step"
                  >
                    Step {q.stage.step} of 7 · {q.stage.headline}
                    {q.stage.group === "waiting" && q.validUntil && (
                      <span className="font-normal"> · valid until {formatDate(q.validUntil)}</span>
                    )}
                  </span>
                </span>
                <MoneyText
                  cents={q.totalCents}
                  className="row-start-1 text-right font-semibold @3xl:col-start-4"
                />
              </Link>
              {q.stage.action && q.stage.action.kind !== "continue_quote" && (
                <JobActionButton
                  stage={q.stage}
                  quoteId={q.id}
                  size="md"
                  variant={q.stage.group === "now" ? "primary" : "secondary"}
                  className="hidden w-60 shrink-0 tablet:inline-flex"
                />
              )}
              {q.status === "draft" && !q.number && (
                <ConfirmDelete
                  iconOnly
                  className="shrink-0"
                  label="Delete this draft quote"
                  title="Delete this draft quote?"
                  description="It hasn't been sent, so nothing reaches the client. This can't be undone."
                  confirmLabel="Delete draft"
                  fields={{ intent: "delete-draft", id: q.id }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {loaderData.hasMore && (
        <div className="mt-4 flex justify-center">
          <Button asChild variant="secondary">
            <Link
              to={`?${new URLSearchParams({ ...Object.fromEntries(params), show: String(loaderData.limit + QUOTE_PAGE_SIZE) })}`}
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

export { RouteErrorBoundary as ErrorBoundary };

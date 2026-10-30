import {
  Activity as ActivityIcon,
  AlertTriangle,
  ArrowRight,
  Banknote,
  Building2,
  ChartColumnBig,
  CircleCheck,
  FileText,
  ListTodo,
  type LucideIcon,
  Sparkles,
  UserPlus,
  Wallet,
} from "lucide-react";
import * as React from "react";
import { Await, Link, useRevalidator, useSearchParams } from "react-router";
import { RouteErrorBoundary } from "~/components/shell/route-error";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { ColumnChart, compactNaira } from "~/components/ui/column-chart";
import { IconChip } from "~/components/ui/icon-chip";
import { KpiCard } from "~/components/ui/kpi-card";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { ErrorState, Loading, Skeleton } from "~/components/ui/states";
import { BUSINESS_TZ, LOCALE } from "~/domain/locale";
import { formatCents } from "~/domain/money";
import { trailingMonths } from "~/domain/reports";
import { CHART_PERIODS } from "~/features/reports/constants";
import { JobActionButton } from "~/features/jobs/ui/job-steps";
import { homeKpis, needsYou, recentActivity, revenueVsExpenses } from "~/features/reports/service";
import { activityLabel, relativeTime } from "~/lib/activity-label";
import { businessToday } from "~/lib/dates";
import type { AppHandle } from "~/lib/route-handle";
import { cn } from "~/lib/utils";
import { schema } from "~/server/db";
import { requireUser } from "~/server/session";
import { count, eq } from "drizzle-orm";
import type { Route } from "./+types/_app._index";

export const handle: AppHandle = { module: "home", title: "Home" };

export function meta() {
  return [
    { title: "Home · Insides Interior" },
    { name: "description", content: "Quotes and invoicing for Insides Interior Limited." },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireUser(context.cloudflare.env, request);
  const months = Number(new URL(request.url).searchParams.get("months")) === 12 ? 12 : 6;
  const now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat(LOCALE, { hour: "numeric", hourCycle: "h23", timeZone: BUSINESS_TZ }).format(now),
  );
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const date = new Intl.DateTimeFormat(LOCALE, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: BUSINESS_TZ,
  }).format(now);
  // A brand-new account sees the setup steps instead of empty widgets.
  const [[quotes], [clients]] = await Promise.all([
    ctx.db.select({ n: count() }).from(schema.quote).where(eq(schema.quote.businessId, ctx.user.businessId)),
    ctx.db
      .select({ n: count() })
      .from(schema.client)
      .where(eq(schema.client.businessId, ctx.user.businessId)),
  ]);
  const fresh = (quotes?.n ?? 0) === 0;
  // Each widget streams on its own so one slow or failed query never blanks the page (FR-RPT-01).
  return {
    greeting,
    date,
    fresh,
    hasClients: (clients?.n ?? 0) > 0,
    months,
    kpis: homeKpis(ctx),
    needs: needsYou(ctx),
    chart: revenueVsExpenses(ctx, trailingMonths(months, businessToday())),
    activity: recentActivity(ctx),
  };
}

const STEPS = [
  {
    title: "Business details",
    description: "Logo, brand colour, tax numbers and payment instructions.",
    to: "/settings",
    icon: Building2,
    tone: "teal",
  },
  {
    title: "Add your first client",
    description: "Contacts and site addresses, ready for quoting.",
    to: "/clients",
    icon: UserPlus,
    tone: "terracotta",
  },
  {
    title: "Create your first quote",
    description: "Build it room by room and send it for approval.",
    to: "/quotes",
    icon: FileText,
    tone: "plum",
  },
] as const;

/** One widget's frame: heading, then skeleton → content, or an error with Retry. */
function Widget<T>({
  id,
  title,
  icon: _icon,
  action,
  resolve,
  skeleton,
  children,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  action?: React.ReactNode;
  resolve: Promise<T>;
  skeleton: React.ReactNode;
  children: (value: T) => React.ReactNode;
}) {
  // Inset-grouped (premium redesign 2): the heading sits above the group.
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-2.5">
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 px-1">
        <h2 id={`${id}-heading`} className="text-section font-semibold">
          {title}
        </h2>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="overflow-hidden rounded-card border border-border bg-surface">
        <React.Suspense fallback={<Loading label={`Loading ${title.toLowerCase()}`}>{skeleton}</Loading>}>
          <Await resolve={resolve} errorElement={<WidgetError title={title} />}>
            {(value) => children(value as T)}
          </Await>
        </React.Suspense>
      </div>
    </section>
  );
}

function WidgetError({ title }: { title: string }) {
  const revalidator = useRevalidator();
  return (
    <div className="p-5 tablet:p-6">
      <ErrorState
        title={`${title} didn't load`}
        message="Check your connection and try again."
        onRetry={() => revalidator.revalidate()}
        retrying={revalidator.state === "loading"}
      />
    </div>
  );
}

function KpiSkeleton() {
  return (
    <Loading label="Loading figures">
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className="rounded-card border border-border bg-surface p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-4 h-8 w-32" />
            <Skeleton className="mt-2 h-3.5 w-20" />
          </div>
        ))}
      </div>
    </Loading>
  );
}

function Kpis({ resolve }: { resolve: Route.ComponentProps["loaderData"]["kpis"] }) {
  return (
    <section aria-label="Key figures">
      <React.Suspense fallback={<KpiSkeleton />}>
        <Await resolve={resolve} errorElement={<WidgetError title="Key figures" />}>
          {(k) => {
            const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
            return (
              <div className="grid grid-cols-2 gap-3">
                <KpiCard
                  label="Outstanding"
                  value={formatCents(k.outstandingCents)}
                  detail={plural(k.outstandingCount, "invoice")}
                  tone="indigo"
                  icon={Wallet}
                  to="/invoices?status=outstanding"
                />
                <KpiCard
                  label="Overdue"
                  value={formatCents(k.overdueCents)}
                  detail={k.overdueCount ? plural(k.overdueCount, "invoice") : "Nothing overdue"}
                  tone="danger"
                  icon={AlertTriangle}
                  to="/invoices?status=overdue"
                />
                <KpiCard
                  label="Paid this month"
                  value={formatCents(k.paidMonthCents)}
                  detail={plural(k.paidMonthCount, "payment")}
                  tone="sage"
                  icon={Banknote}
                  to={`/payments?from=${k.monthStart}`}
                />
                <KpiCard
                  label="Quotes awaiting answer"
                  value={formatCents(k.awaitingCents)}
                  detail={plural(k.awaitingCount, "quote")}
                  tone="plum"
                  icon={FileText}
                  to="/quotes?step=waiting"
                />
              </div>
            );
          }}
        </Await>
      </React.Suspense>
    </section>
  );
}

function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-border">
      {Array.from({ length: rows }, (_, n) => (
        <li key={n} className="flex items-center gap-3 px-5 py-3 tablet:px-6">
          <Skeleton className="size-9 rounded-full" />
          <span className="flex-1">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-3.5 w-56" />
          </span>
        </li>
      ))}
    </ul>
  );
}

const MONTH = new Intl.DateTimeFormat(LOCALE, { month: "short", timeZone: "UTC" });
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return MONTH.format(new Date(Date.UTC(y, m - 1, 1)));
};

export default function Home({ loaderData }: Route.ComponentProps) {
  const [, setParams] = useSearchParams();
  return (
    <div className="flex flex-col gap-6">
      <section className="px-1 pt-1">
        <p className="text-label font-medium text-secondary">{loaderData.date}</p>
        <h2 className="mt-1 font-display text-display">{loaderData.greeting}</h2>
        <p className="mt-1.5 max-w-xl text-secondary">
          {loaderData.fresh
            ? "Welcome to your new studio app. Three quick steps and you're ready to send your first quote."
            : "Here's where the studio stands today."}
        </p>
      </section>

      {loaderData.fresh && <SetupSteps hasClients={loaderData.hasClients} />}

      <div className="grid gap-6 wide:grid-cols-2 wide:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <Kpis resolve={loaderData.kpis} />
          <Widget
            id="needs"
            title="What to do next"
            icon={ListTodo}
            resolve={loaderData.needs}
            skeleton={<ListSkeleton />}
            action={
              <Link
                to="/quotes?step=needs"
                className="inline-flex min-h-11 items-center gap-1 rounded-control px-2 font-semibold text-accent hover:bg-accent-tint"
              >
                All jobs
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            }
          >
            {(groups) =>
              groups.length === 0 ? (
                <p className="flex items-center gap-2 px-5 py-6 text-secondary tablet:px-6">
                  <CircleCheck className="size-5 text-sage-base" aria-hidden />
                  You're all caught up.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {groups.map((group) => (
                    <section key={group.key} aria-labelledby={`needs-${group.key}`}>
                      <h3
                        id={`needs-${group.key}`}
                        className={cn(
                          "px-5 pt-4 pb-1 text-micro font-bold tracking-[0.06em] uppercase tablet:px-6",
                          group.key === "now" ? "text-accent" : "text-secondary",
                        )}
                      >
                        {group.title}
                        {group.total > group.items.length && (
                          <span className="font-medium normal-case"> · {group.total}</span>
                        )}
                      </h3>
                      <ul>
                        {group.items.map((item) => (
                          <li
                            key={`${item.kind}-${item.key}`}
                            className="flex flex-col gap-2.5 px-5 py-3 tablet:flex-row tablet:items-center tablet:gap-3 tablet:px-6"
                          >
                            <Link to={item.to} className="flex min-w-0 flex-1 items-center gap-3">
                              <Avatar name={item.clientName ?? "No client"} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-semibold">
                                  {item.clientName ?? item.title}
                                  {item.clientName && (
                                    <span className="font-normal text-secondary"> · {item.title}</span>
                                  )}
                                </span>
                                <span className="block truncate text-label text-secondary">{item.line}</span>
                              </span>
                            </Link>
                            {item.job ? (
                              <JobActionButton
                                stage={item.job.stage}
                                quoteId={item.job.quoteId}
                                size="md"
                                variant={group.key === "now" ? "primary" : "secondary"}
                                className="w-full tablet:w-56"
                              />
                            ) : (
                              item.action && (
                                <Button
                                  asChild
                                  size="md"
                                  variant={group.key === "now" ? "primary" : "secondary"}
                                  className="w-full tablet:w-56"
                                >
                                  <Link to={item.to}>{item.action}</Link>
                                </Button>
                              )
                            )}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )
            }
          </Widget>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Widget
            id="chart"
            title="Revenue and expenses"
            icon={ChartColumnBig}
            resolve={loaderData.chart}
            skeleton={
              <div className="p-5 tablet:p-6">
                <Skeleton className="h-56 w-full" />
              </div>
            }
            action={
              <SegmentedControl
                label="Chart period"
                value={String(loaderData.months)}
                onValueChange={(months) =>
                  setParams(months === "6" ? {} : { months }, { preventScrollReset: true, replace: true })
                }
                segments={CHART_PERIODS.map((m) => ({ value: String(m), label: `${m} months` }))}
              />
            }
          >
            {(rows) => (
              <div className="p-5 tablet:p-6">
                <ColumnChart
                  title={`Revenue before VAT and expenses less VAT, last ${loaderData.months} months`}
                  categories={rows.map((r) => monthLabel(r.month))}
                  series={[
                    {
                      key: "revenue",
                      label: "Revenue",
                      tone: "teal",
                      values: rows.map((r) => r.revenueCents),
                    },
                    {
                      key: "expenses",
                      label: "Expenses",
                      tone: "roseclay",
                      values: rows.map((r) => r.expensesCents),
                    },
                  ]}
                  format={formatCents}
                  formatAxis={compactNaira}
                />
                <p className="mt-3 text-label text-secondary">
                  Invoiced before VAT, by issue date.{" "}
                  <Link
                    to="/reports"
                    className="font-semibold text-ocean-ink underline-offset-2 hover:underline"
                  >
                    Open reports
                  </Link>
                </p>
              </div>
            )}
          </Widget>

          <Widget
            id="activity"
            title="Recent activity"
            icon={ActivityIcon}
            resolve={loaderData.activity}
            skeleton={<ListSkeleton rows={5} />}
          >
            {(rows) =>
              rows.length === 0 ? (
                <p className="px-5 py-6 text-secondary tablet:px-6">Activity appears here as you work.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {rows.map((a) => {
                    const subject =
                      a.entityType === "quote"
                        ? `Quote ${a.number ?? "draft"}`
                        : a.entityType === "invoice"
                          ? `Invoice ${a.number ?? "draft"}`
                          : a.entityType === "project"
                            ? (a.projectName ?? "Project")
                            : a.entityType === "expense"
                              ? "Expense"
                              : a.entityType === "payment"
                                ? "Payment"
                                : null;
                    return (
                      <li key={a.id} className="flex items-center gap-3 px-5 py-3 tablet:px-6">
                        <Avatar name={a.clientName ?? "Insides Interior"} size="sm" />
                        <p className="min-w-0 flex-1">
                          <span className="block truncate">{activityLabel(a.action, a.data)}</span>
                          <span className="block truncate text-label text-secondary">
                            {[subject, a.clientName].filter(Boolean).join(" · ")}
                          </span>
                        </p>
                        <time dateTime={a.at} className="shrink-0 text-label text-secondary">
                          {relativeTime(a.at)}
                        </time>
                      </li>
                    );
                  })}
                </ul>
              )
            }
          </Widget>
        </div>
      </div>
    </div>
  );
}

function SetupSteps({ hasClients }: { hasClients: boolean }) {
  return (
    <section
      aria-labelledby="setup-heading"
      className="rounded-sheet border border-border bg-surface shadow-card"
    >
      <div className="flex items-center gap-3 border-b border-border px-5 py-4 tablet:px-6">
        <Sparkles className="size-4.5 text-teal-ink" aria-hidden />
        <h2 id="setup-heading" className="font-display text-title">
          Get set up
        </h2>
      </div>
      <ol className="grid divide-y divide-border wide:grid-cols-3 wide:divide-x wide:divide-y-0">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <Link
              to={step.to}
              className="group flex h-full min-h-28 flex-col gap-3 px-5 py-5 transition-colors duration-fast ease-out hover:bg-surface-2 tablet:px-6"
            >
              <span className="flex items-center justify-between">
                <IconChip icon={step.icon} tone={step.tone} size="md" />
                <span className="font-display text-section text-tertiary tabular">
                  {index === 1 && hasClients ? "Done" : String(index + 1).padStart(2, "0")}
                </span>
              </span>
              <span>
                <span className="sr-only">Step {index + 1}: </span>
                <span className="flex items-center gap-1.5 font-semibold">
                  {step.title}
                  <ArrowRight
                    className="size-4 text-tertiary transition-transform duration-fast ease-out group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </span>
                <span className="mt-1 block text-label font-normal text-secondary">{step.description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

export { RouteErrorBoundary as ErrorBoundary };

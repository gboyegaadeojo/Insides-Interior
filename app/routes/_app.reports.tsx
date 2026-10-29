import { Download } from "lucide-react";
import * as React from "react";
import { Form, Link, useSearchParams } from "react-router";
import { ModuleHeader } from "~/components/shell/module-header";
import { RouteErrorBoundary } from "~/components/shell/route-error";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { ColumnChart, compactNaira } from "~/components/ui/column-chart";
import { DateField } from "~/components/ui/field";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { StatusBadge } from "~/components/ui/status-badge";
import { MoneyText } from "~/components/ui/text";
import { LOCALE } from "~/domain/locale";
import { formatBp, formatCents } from "~/domain/money";
import {
  AGING_BUCKETS,
  AGING_LABEL,
  matchPreset,
  PERIOD_LABEL,
  PERIOD_PRESETS,
  presetRange,
} from "~/domain/reports";
import {
  BASES,
  BASIS_EXPLAINER,
  BASIS_LABEL,
  type Basis,
  ITEM_TYPE_LABEL,
  REPORT_LABEL,
  REPORT_QUESTION,
  REPORTS,
  type ReportName,
} from "~/features/reports/constants";
import { agedReceivables, revenueReport, salesTaxReport } from "~/features/reports/service";
import { ExportSheet } from "~/features/reports/ui/export-sheet";
import { businessToday, formatDate, isIsoDate } from "~/lib/dates";
import type { AppHandle } from "~/lib/route-handle";
import { cn } from "~/lib/utils";
import { requireUser } from "~/server/session";
import type { Route } from "./+types/_app.reports";

export const handle: AppHandle = { module: "reports", title: "Reports" };

export function meta() {
  return [{ title: "Reports · Insides Interior" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireUser(context.cloudflare.env, request);
  const url = new URL(request.url);
  const today = businessToday();
  const report = (REPORTS.find((r) => r === url.searchParams.get("report")) ?? "revenue") as ReportName;
  const basis = (BASES.find((b) => b === url.searchParams.get("basis")) ?? "accrual") as Basis;
  const preset = PERIOD_PRESETS.find((p) => p === url.searchParams.get("period"));
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const custom = isIsoDate(from) && isIsoDate(to) && from <= to ? { from, to } : null;
  const period = custom ?? presetRange(preset ?? "this-year", today);
  const base = { report, basis, period, today, preset: matchPreset(period.from, period.to, today) };
  // Only the report on screen is computed (Workers CPU budget).
  if (report === "aged")
    return { ...base, aged: await agedReceivables(ctx, today), tax: null, revenue: null };
  if (report === "tax")
    return { ...base, tax: await salesTaxReport(ctx, period, basis), aged: null, revenue: null };
  return { ...base, revenue: await revenueReport(ctx, period, basis), tax: null, aged: null };
}

const MONTH = new Intl.DateTimeFormat(LOCALE, { month: "short", year: "2-digit", timeZone: "UTC" });
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return MONTH.format(new Date(Date.UTC(y, m - 1, 1)));
};

function presetLink(params: URLSearchParams, preset: string) {
  const next = new URLSearchParams(params);
  next.set("period", preset);
  next.delete("from");
  next.delete("to");
  return `?${next}`;
}

export default function Reports({ loaderData }: Route.ComponentProps) {
  const [params, setParams] = useSearchParams();
  const [exporting, setExporting] = React.useState(false);
  const { report, basis, period } = loaderData;
  const set = (next: Record<string, string | null>) =>
    setParams(
      (p) => {
        for (const [k, v] of Object.entries(next)) {
          if (v === null) p.delete(k);
          else p.set(k, v);
        }
        return p;
      },
      { preventScrollReset: true },
    );
  const periodText = `${formatDate(period.from)} to ${formatDate(period.to)}`;

  return (
    <>
      <ModuleHeader
        eyebrow="Reports"
        summary={REPORT_QUESTION[report]}
        action={
          <Button size="lg" variant="tinted" onClick={() => setExporting(true)}>
            <Download aria-hidden />
            Export
          </Button>
        }
      />
      <SegmentedControl
        label="Report"
        className="mb-4"
        value={report}
        onValueChange={(r) => set({ report: r })}
        segments={REPORTS.map((r) => ({ value: r, label: REPORT_LABEL[r] }))}
      />

      {report !== "aged" && (
        <div className="mb-5 flex flex-col gap-3 rounded-card border border-border bg-surface p-4 shadow-card">
          <nav aria-label="Period" className="flex flex-wrap gap-2">
            {PERIOD_PRESETS.map((p) => (
              <Link
                key={p}
                to={presetLink(params, p)}
                preventScrollReset
                aria-current={loaderData.preset === p ? "true" : undefined}
                className={cn(
                  "inline-flex h-11 items-center rounded-full border px-4 font-semibold",
                  loaderData.preset === p
                    ? "border-ocean-base bg-ocean-tint text-ocean-ink"
                    : "border-border bg-surface",
                )}
              >
                {PERIOD_LABEL[p]}
              </Link>
            ))}
          </nav>
          <Form method="get" className="flex flex-wrap items-end gap-3" preventScrollReset>
            <input type="hidden" name="report" value={report} />
            <input type="hidden" name="basis" value={basis} />
            <DateField
              label="From"
              name="from"
              defaultValue={period.from}
              key={`f${period.from}`}
              fieldClassName="w-40"
            />
            <DateField
              label="To"
              name="to"
              defaultValue={period.to}
              key={`t${period.to}`}
              fieldClassName="w-40"
            />
            <Button type="submit" variant="secondary">
              Show
            </Button>
          </Form>
          <div className="flex flex-col gap-1">
            <SegmentedControl
              label="Basis"
              value={basis}
              onValueChange={(b) => set({ basis: b })}
              segments={BASES.map((b) => ({ value: b, label: BASIS_LABEL[b] }))}
            />
            <p className="text-label text-secondary">{BASIS_EXPLAINER[basis]}</p>
          </div>
        </div>
      )}

      <section aria-labelledby="report-heading">
        <h2 id="report-heading" className="font-display text-title">
          {REPORT_LABEL[report]}
        </h2>
        <p className="mt-1 mb-4 text-secondary" data-testid="report-scope">
          {report === "aged"
            ? `Open balances on ${formatDate(loaderData.today)}, by days past the due date.`
            : `${periodText} · ${BASIS_LABEL[basis]}`}
        </p>
        {loaderData.revenue && <RevenueView data={loaderData.revenue} />}
        {loaderData.tax && <TaxView data={loaderData.tax} />}
        {loaderData.aged && <AgedView data={loaderData.aged} />}
      </section>

      <ExportSheet
        key={`${period.from}-${period.to}`}
        open={exporting}
        onOpenChange={setExporting}
        from={period.from}
        to={period.to}
      />
    </>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-card border border-border bg-surface p-5 shadow-card", className)}>
      {children}
    </div>
  );
}

function Total({ label, cents, note }: { label: string; cents: number; note?: string }) {
  return (
    <div>
      <p className="text-label font-semibold text-secondary">{label}</p>
      <p className="mt-1 text-kpi font-[650] tabular">{formatCents(cents)}</p>
      {note && <p className="mt-1 text-label text-secondary">{note}</p>}
    </div>
  );
}

const TOP_ROWS = 10;

/** A table with proportional bars beside each amount (the bars are decoration; the numbers are the data). */
function ShareTable({
  caption,
  head,
  rows,
  total,
}: {
  caption: string;
  head: string;
  rows: { key: string; label: React.ReactNode; cents: number }[];
  total: number;
}) {
  const [all, setAll] = React.useState(false);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.cents)));
  const shown = all ? rows : rows.slice(0, TOP_ROWS);
  return (
    <table className="w-full text-left">
      <caption className="mb-2 text-left font-semibold">{caption}</caption>
      <thead>
        <tr className="border-b border-border text-label text-secondary">
          <th scope="col" className="py-2 pr-3 font-semibold">
            {head}
          </th>
          <th scope="col" className="py-2 pl-3 text-right font-semibold">
            Revenue
          </th>
          <th scope="col" className="hidden w-[30%] py-2 pl-3 tablet:table-cell">
            <span className="sr-only">Share</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {shown.map((r) => (
          <tr key={r.key} className="border-b border-border">
            <th scope="row" className="py-2 pr-3 font-normal">
              {r.label}
            </th>
            <td className="py-2 pl-3 text-right tabular">{formatCents(r.cents)}</td>
            <td className="hidden py-2 pl-3 tablet:table-cell" aria-hidden>
              <span
                className="block h-2 rounded-full bg-teal-base"
                style={{ width: `${(Math.max(0, r.cents) / max) * 100}%` }}
              />
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        {rows.length > TOP_ROWS && (
          <tr>
            <td colSpan={3} className="py-2">
              <Button variant="ghost" onClick={() => setAll((a) => !a)} aria-expanded={all}>
                {all ? `Show the top ${TOP_ROWS}` : `Show all ${rows.length}`}
              </Button>
            </td>
          </tr>
        )}
        <tr>
          <th scope="row" className="py-2 pr-3 text-left">
            Total
          </th>
          <td className="py-2 pl-3 text-right font-semibold tabular">{formatCents(total)}</td>
          <td className="hidden tablet:table-cell" />
        </tr>
      </tfoot>
    </table>
  );
}

function RevenueView({ data }: { data: NonNullable<Route.ComponentProps["loaderData"]["revenue"]> }) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <Total
          label="Revenue before VAT"
          cents={data.totalCents}
          note={
            data.basis === "cash" ? "The pre-VAT part of money received." : "Sent invoices, voids excluded."
          }
        />
      </Card>
      <Card>
        <ColumnChart
          title="Revenue by month"
          categories={data.months.map((m) => monthLabel(m.month))}
          series={[
            { key: "revenue", label: "Revenue", tone: "teal", values: data.months.map((m) => m.cents) },
          ]}
          format={formatCents}
          formatAxis={compactNaira}
        />
      </Card>
      <div className="grid gap-4 wide:grid-cols-2">
        <Card>
          <ShareTable
            caption="By client"
            head="Client"
            total={data.totalCents}
            rows={data.clients.map((c) => ({
              key: c.id || "none",
              cents: c.cents,
              label: (
                <span className="flex items-center gap-2">
                  <Avatar name={c.name} size="sm" />
                  {c.id ? (
                    <Link to={`/clients/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                  ) : (
                    c.name
                  )}
                </span>
              ),
            }))}
          />
        </Card>
        <Card>
          <ShareTable
            caption="By item type"
            head="Type"
            total={data.totalCents}
            rows={data.types.map((t) => ({
              key: t.type,
              cents: t.cents,
              label: ITEM_TYPE_LABEL[t.type] ?? t.type,
            }))}
          />
        </Card>
      </div>
    </div>
  );
}

function TaxView({ data }: { data: NonNullable<Route.ComponentProps["loaderData"]["tax"]> }) {
  return (
    <div className="flex flex-col gap-4">
      <Card className="grid gap-5 tablet:grid-cols-3">
        <Total label="VAT charged" cents={data.collectedCents} />
        <Total
          label="VAT paid on expenses"
          cents={data.paidOnExpensesCents}
          note={`${data.expensesWithVat} expense${data.expensesWithVat === 1 ? "" : "s"} with VAT, by date paid`}
        />
        <Total label="Net VAT (charged less paid)" cents={data.netCents} />
      </Card>
      <Card>
        {data.taxes.length === 0 ? (
          <p className="text-secondary">
            No VAT was charged in this period. Sales before VAT: <MoneyText cents={data.salesCents} />.
          </p>
        ) : (
          <table className="w-full text-left">
            <caption className="mb-2 text-left font-semibold">By tax</caption>
            <thead>
              <tr className="border-b border-border text-label text-secondary">
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Tax
                </th>
                <th scope="col" className="py-2 pl-3 text-right font-semibold">
                  Taxable sales
                </th>
                <th scope="col" className="py-2 pl-3 text-right font-semibold">
                  Tax charged
                </th>
              </tr>
            </thead>
            <tbody>
              {data.taxes.map((t) => (
                <tr key={t.id} className="border-b border-border">
                  <th scope="row" className="py-2 pr-3 font-normal">
                    {t.name} {formatBp(t.rateBp)}%
                  </th>
                  <td className="py-2 pl-3 text-right tabular">{formatCents(t.taxableCents)}</td>
                  <td className="py-2 pl-3 text-right tabular">{formatCents(t.taxCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="py-2 pr-3 text-left">
                  All sales before VAT
                </th>
                <td className="py-2 pl-3 text-right font-semibold tabular">{formatCents(data.salesCents)}</td>
                <td className="py-2 pl-3 text-right font-semibold tabular">
                  {formatCents(data.collectedCents)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </Card>
    </div>
  );
}

function AgedView({ data }: { data: NonNullable<Route.ComponentProps["loaderData"]["aged"]> }) {
  if (data.total.totalCents === 0) {
    return (
      <Card>
        <p className="text-secondary">Nothing is owed right now. Every sent invoice is paid.</p>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <ul className="grid grid-cols-2 gap-3 tablet:grid-cols-3 wide:grid-cols-6" aria-label="Totals by age">
        {AGING_BUCKETS.map((b) => (
          <li
            key={b}
            className={cn(
              "rounded-card border border-border bg-surface p-4",
              b !== "current" && data.total[b] > 0 && "border-l-4 border-l-danger-base",
            )}
          >
            <p className="text-label font-semibold text-secondary">{AGING_LABEL[b]}</p>
            <p className="mt-1 font-semibold tabular">{formatCents(data.total[b])}</p>
          </li>
        ))}
        <li className="rounded-card border border-ocean-base bg-ocean-tint p-4 text-ocean-ink">
          <p className="text-label font-semibold">Total owed</p>
          <p className="mt-1 font-semibold tabular">{formatCents(data.total.totalCents)}</p>
        </li>
      </ul>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left">
          <caption className="mb-2 text-left font-semibold">By client</caption>
          <thead>
            <tr className="border-b border-border text-label text-secondary">
              <th scope="col" className="py-2 pr-3 font-semibold">
                Client
              </th>
              {AGING_BUCKETS.map((b) => (
                <th key={b} scope="col" className="py-2 pl-3 text-right font-semibold">
                  {AGING_LABEL[b]}
                </th>
              ))}
              <th scope="col" className="py-2 pl-3 text-right font-semibold">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {data.clients.map((c) => (
              <tr key={c.clientId} className="border-b border-border">
                <th scope="row" className="py-2 pr-3 font-normal">
                  {c.clientId ? (
                    <Link to={`/clients/${c.clientId}`} className="hover:underline">
                      {c.clientName}
                    </Link>
                  ) : (
                    c.clientName
                  )}
                </th>
                {AGING_BUCKETS.map((b) => (
                  <td key={b} className={cn("py-2 pl-3 text-right tabular", c[b] === 0 && "text-tertiary")}>
                    {c[b] === 0 ? "–" : formatCents(c[b])}
                  </td>
                ))}
                <td className="py-2 pl-3 text-right font-semibold tabular">{formatCents(c.totalCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="py-2 pr-3 text-left">
                Total
              </th>
              {AGING_BUCKETS.map((b) => (
                <td key={b} className="py-2 pl-3 text-right font-semibold tabular">
                  {formatCents(data.total[b])}
                </td>
              ))}
              <td className="py-2 pl-3 text-right font-semibold tabular">
                {formatCents(data.total.totalCents)}
              </td>
            </tr>
          </tfoot>
        </table>
      </Card>
      <Card>
        <h3 className="mb-2 font-semibold">Open invoices</h3>
        <ul className="divide-y divide-border">
          {data.invoices.map((inv) => (
            <li key={inv.id}>
              <Link
                to={`/invoices/${inv.id}`}
                className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 py-2 hover:bg-surface-2"
              >
                <span className="font-semibold">{inv.number}</span>
                <span className="min-w-0 flex-1 truncate text-secondary">{inv.clientName}</span>
                <span className="text-label text-secondary">due {formatDate(inv.dueDate)}</span>
                <StatusBadge status={inv.status} size="sm" />
                <MoneyText cents={inv.balanceCents} className="w-32 text-right font-semibold" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };

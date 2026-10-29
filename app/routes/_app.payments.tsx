import { Banknote } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { ModuleHeader } from "~/components/shell/module-header";
import { RouteErrorBoundary } from "~/components/shell/route-error";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/states";
import { StatusBadge } from "~/components/ui/status-badge";
import { MoneyText } from "~/components/ui/text";
import { formatCents } from "~/domain/money";
import { PAYMENT_METHOD_LABEL, PAYMENT_PAGE_SIZE } from "~/features/invoices/constants";
import { listPayments } from "~/features/invoices/service";
import { formatDate, isIsoDate } from "~/lib/dates";
import type { AppHandle } from "~/lib/route-handle";
import { requireUser } from "~/server/session";
import type { Route } from "./+types/_app.payments";

export const handle: AppHandle = { module: "payments", title: "Payments" };

export function meta() {
  return [{ title: "Payments · Insides Interior" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireUser(context.cloudflare.env, request);
  const url = new URL(request.url);
  const limit = Math.max(PAYMENT_PAGE_SIZE, Number(url.searchParams.get("show")) || 0);
  // FR-RPT-06: Home's "Paid this month" opens this list from the 1st; the filter is in the URL.
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const range = {
    from: from && isIsoDate(from) ? from : null,
    to: to && isIsoDate(to) ? to : null,
  };
  return { ...(await listPayments(ctx, { limit, ...range })), limit, ...range };
}

/**
 * FR-PAY-05: every payment, linked to its invoice and client. A payment row
 * (money in, sage) looks different from the invoice it settles (status badge);
 * deleted payments stay, struck through, with their reason.
 */
export default function Payments({ loaderData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const { payments } = loaderData;
  return (
    <>
      <ModuleHeader
        eyebrow="Payments"
        summary={`${formatCents(loaderData.monthCents)} received this month`}
      />
      {(loaderData.from || loaderData.to) && (
        <p className="mb-4 flex flex-wrap items-center gap-2 text-secondary">
          <span className="inline-flex h-9 items-center rounded-full bg-ocean-tint px-3 font-semibold text-ocean-ink">
            {loaderData.from && loaderData.to
              ? `${formatDate(loaderData.from)} to ${formatDate(loaderData.to)}`
              : loaderData.from
                ? `Received since ${formatDate(loaderData.from)}`
                : `Received up to ${formatDate(loaderData.to)}`}
          </span>
          <Link
            to="/payments"
            className="inline-flex min-h-11 items-center px-2 font-semibold text-ocean-ink hover:underline"
          >
            Show all payments
          </Link>
        </p>
      )}
      {payments.length === 0 ? (
        <EmptyState
          icon={Banknote}
          tone="ocean"
          title="No payments yet"
          description="Record a payment from an invoice and it appears here, linked to the invoice and client."
          action={
            <Button asChild variant="secondary">
              <Link to="/invoices?status=outstanding">See outstanding invoices</Link>
            </Button>
          }
        />
      ) : (
        <ul
          className="@container divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-card"
          aria-label="Payments"
        >
          {payments.map((p) => (
            <li key={p.id}>
              <Link
                to={`/invoices/${p.invoiceId}`}
                className="grid min-h-16 grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors duration-fast hover:bg-surface-2 @2xl:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_10rem_9rem]"
              >
                <Avatar name={p.clientName} />
                <span className={p.deletedAt ? "min-w-0 text-secondary" : "min-w-0"}>
                  <span className="block truncate font-semibold">
                    {p.clientName}
                    <span className="font-normal text-secondary"> · {p.invoiceNumber}</span>
                  </span>
                  <span className="block truncate text-label font-normal text-secondary">
                    {formatDate(p.receivedOn)} · {PAYMENT_METHOD_LABEL[p.method]}
                    {p.reference && ` · ${p.reference}`}
                    <span className="@2xl:hidden">
                      {p.whtCents > 0 && ` · WHT ${formatCents(p.whtCents)}`}
                      {p.creditCents > 0 && ` · ${formatCents(p.creditCents)} to credit`}
                    </span>
                    {p.deletedAt && ` · Deleted: ${p.deleteReason}`}
                  </span>
                </span>
                <span className="hidden text-label text-secondary @2xl:block">
                  {p.whtCents > 0 && `WHT ${formatCents(p.whtCents)}`}
                  {p.creditCents > 0 && ` · ${formatCents(p.creditCents)} to credit`}
                </span>
                <span className={p.deletedAt ? "text-right text-secondary line-through" : "text-right"}>
                  <MoneyText
                    cents={p.amountCents + p.creditCents}
                    className="block font-semibold text-sage-ink"
                  />
                </span>
                <span className="col-span-3 justify-self-start @2xl:col-span-1 @2xl:justify-self-end">
                  {p.invoiceStatus !== "draft" && <StatusBadge status={p.invoiceStatus} size="sm" />}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {loaderData.hasMore && (
        <div className="mt-4 flex justify-center">
          <Button asChild variant="secondary">
            <Link
              to={`?${new URLSearchParams({ ...Object.fromEntries(params), show: String(loaderData.limit + PAYMENT_PAGE_SIZE) })}`}
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

import { ArrowRight, ChevronLeft } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { RouteErrorBoundary } from "~/components/shell/route-error";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { StatusBadge, type Status } from "~/components/ui/status-badge";
import { threadById, threadPanelData } from "~/features/conversations/service";
import { ThreadPanel } from "~/features/conversations/ui/thread-panel";
import { invoicesPaid } from "~/features/invoices/service";
import type { AppHandle } from "~/lib/route-handle";
import { requireUser } from "~/server/session";
import type { Route } from "./+types/_app.inbox.$id";

export const handle: AppHandle = { module: "inbox", title: "Inbox" };

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const ctx = await requireUser(context.cloudflare.env, request);
  const found = await threadById(ctx, params.id);
  if (!found) throw new Response("Not found", { status: 404 });
  const { doc, thread } = found;
  const paid = thread.entity === "invoice" ? await invoicesPaid(ctx, [doc.id]) : new Set<string>();
  return {
    entity: thread.entity,
    doc: { id: doc.id, number: doc.number, status: doc.status, clientName: doc.clientName },
    thread: threadPanelData(thread),
    hasPayments: paid.has(doc.id),
    isOwner: ctx.user.role === "owner",
  };
}

export function meta({ data: d }: Route.MetaArgs) {
  return [{ title: `${d?.doc.clientName ?? "Conversation"} · Inbox · Insides Interior` }];
}

export default function InboxThread({ loaderData: d }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const href = `/${d.entity}s/${d.doc.id}`;
  return (
    <div className="flex flex-col gap-4">
      <Link
        to={`/inbox${params.toString() ? `?${params}` : ""}`}
        className="-ml-2 inline-flex min-h-11 items-center gap-1 self-start rounded-control px-2 font-semibold text-ocean-ink wide:hidden"
      >
        <ChevronLeft className="size-5" aria-hidden />
        Inbox
      </Link>
      <Card className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="font-display text-title">{d.doc.clientName ?? "Client"}</p>
          <p className="flex flex-wrap items-center gap-2 text-label text-secondary">
            {d.entity === "quote" ? "Quote" : "Invoice"} {d.doc.number}
            <StatusBadge status={d.doc.status as Status} size="sm" />
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link to={href}>
            Open {d.entity}
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </Card>
      <Card>
        <ThreadPanel
          key={d.doc.id}
          entity={d.entity}
          entityId={d.doc.id}
          thread={d.thread}
          clientName={d.doc.clientName}
          canReply={!!d.doc.number}
          canHide={d.isOwner}
          hasPayments={d.hasPayments}
          heading
        />
      </Card>
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };

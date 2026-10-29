import { Inbox, MessageSquareText, SearchX } from "lucide-react";
import { Form, NavLink, Outlet, useLocation, useNavigation, useSearchParams, useSubmit } from "react-router";
import { ModuleHeader } from "~/components/shell/module-header";
import { RouteErrorBoundary } from "~/components/shell/route-error";
import { SplitView } from "~/components/shell/split-view";
import { Avatar } from "~/components/ui/avatar";
import { Select } from "~/components/ui/field";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { EmptyState } from "~/components/ui/states";
import { INBOX_FILTERS, type InboxFilter } from "~/features/conversations/constants";
import { inboxBadge, listThreads, threadClients, type ThreadListRow } from "~/features/conversations/service";
import { relativeTime } from "~/lib/activity-label";
import type { AppHandle } from "~/lib/route-handle";
import { cn } from "~/lib/utils";
import { requireUser } from "~/server/session";
import type { Route } from "./+types/_app.inbox";

// Inbox (SPEC 6.8, FR-MSG-09): every thread with unread messages or open change
// requests, filterable by client; the thread opens beside the list from tablet
// landscape up and replaces it below that.

export const handle: AppHandle = { module: "inbox", title: "Inbox" };

export function meta() {
  return [{ title: "Inbox · Insides Interior" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireUser(context.cloudflare.env, request);
  const url = new URL(request.url);
  const filter: InboxFilter = url.searchParams.get("show") === "all" ? "all" : "open";
  const clientId = url.searchParams.get("client") || null;
  const [threads, clients, waiting] = await Promise.all([
    listThreads(ctx, { filter, clientId }),
    threadClients(ctx),
    inboxBadge(ctx),
  ]);
  return { threads, clients, waiting, filter, clientId };
}

export default function InboxLayout({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const showDetail = /^\/inbox\/[^/]+/.test(pathname);
  const { waiting } = loaderData;
  return (
    <>
      <ModuleHeader
        eyebrow="Inbox"
        summary={
          waiting === 0
            ? "You're all caught up"
            : `${waiting} conversation${waiting === 1 ? " needs" : "s need"} you`
        }
      />
      <SplitView
        showDetail={showDetail}
        list={<ThreadList {...loaderData} />}
        detail={<Outlet />}
        emptyDetail={
          <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border p-8 text-center text-secondary">
            <MessageSquareText className="size-6 text-tertiary" aria-hidden />
            Choose a conversation to read and reply.
          </div>
        }
      />
    </>
  );
}

const NOUN = { quote: "Quote", invoice: "Invoice" } as const;

function ThreadList({ threads, clients, filter, clientId }: Route.ComponentProps["loaderData"]) {
  const [params] = useSearchParams();
  const submit = useSubmit();
  const navigation = useNavigation();
  const loading = navigation.state === "loading" && navigation.location.pathname === "/inbox";
  const query = params.toString();
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    void submit(next, { method: "get", action: "/inbox", replace: true, preventScrollReset: true });
  };

  return (
    <div className="flex flex-col gap-3" aria-busy={loading || undefined}>
      <Form method="get" className="flex flex-col gap-3 tablet:flex-row tablet:items-end [&>*]:min-w-0">
        <SegmentedControl
          label="Show"
          value={filter}
          onValueChange={(next) => setParam("show", next === "all" ? "all" : null)}
          segments={INBOX_FILTERS.map((f) => ({ value: f, label: f === "open" ? "Needs you" : "All" }))}
        />
        {clients.length > 1 && (
          <Select
            label="Client"
            value={clientId ?? ""}
            onChange={(e) => setParam("client", e.target.value || null)}
            fieldClassName="tablet:flex-1"
          >
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
      </Form>

      {threads.length === 0 ? (
        clientId || filter === "all" ? (
          <EmptyState
            icon={SearchX}
            tone="ocean"
            title="No conversations here"
            description="Nothing matches these filters. Try All, or another client."
          />
        ) : (
          <EmptyState
            icon={Inbox}
            tone="ocean"
            title="You're all caught up"
            description="Messages and change requests from clients collect here. Switch to All to see past conversations."
          />
        )
      ) : (
        <ul
          className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-card"
          aria-label="Conversations"
        >
          {threads.map((t) => (
            <ThreadRow key={t.id} thread={t} query={query} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ThreadRow({ thread: t, query }: { thread: ThreadListRow; query: string }) {
  const unread = t.ownerUnread > 0;
  const name = t.clientName ?? "Client";
  return (
    <li>
      <NavLink
        to={`/inbox/${t.id}${query ? `?${query}` : ""}`}
        className={({ isActive }) =>
          cn(
            "flex min-h-18 items-start gap-3 px-4 py-3 transition-colors duration-fast hover:bg-surface-2",
            isActive && "bg-ocean-tint shadow-[inset_3px_0_0_var(--ocean-base)]",
          )
        }
      >
        <Avatar name={name} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn("min-w-0 flex-1 truncate", unread ? "font-bold" : "font-semibold")}>
              {name}
            </span>
            {t.lastMessageAt && (
              <time dateTime={t.lastMessageAt} className="shrink-0 text-micro text-secondary">
                {relativeTime(t.lastMessageAt)}
              </time>
            )}
          </span>
          <span className="block text-label text-secondary">
            {NOUN[t.entityType]} {t.number ?? ""}
          </span>
          <span className={cn("mt-0.5 line-clamp-2 text-label", unread ? "text-primary" : "text-secondary")}>
            {t.lastBody ? `${t.fromClient ? "" : "You: "}${t.lastBody}` : "Change request"}
          </span>
          {(t.openRequests > 0 || unread) && (
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {unread && (
                <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-ocean-tint px-2 text-micro font-semibold text-ocean-ink">
                  <span aria-hidden className="size-2 rounded-full bg-ocean-base" />
                  {t.ownerUnread} unread
                </span>
              )}
              {t.openRequests > 0 && (
                <span className="inline-flex h-6 items-center rounded-full bg-saffron-tint px-2 text-micro font-semibold text-saffron-ink">
                  {t.openRequests} change request{t.openRequests === 1 ? "" : "s"}
                </span>
              )}
            </span>
          )}
        </span>
      </NavLink>
    </li>
  );
}

export { RouteErrorBoundary as ErrorBoundary };

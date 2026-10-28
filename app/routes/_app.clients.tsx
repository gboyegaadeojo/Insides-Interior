import { Archive, Plus, Search, Users } from "lucide-react";
import * as React from "react";
import {
  Form,
  Link,
  NavLink,
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
import { SplitView } from "~/components/shell/split-view";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Sheet, SheetContent } from "~/components/ui/sheet";
import { EmptyState } from "~/components/ui/states";
import { MoneyText } from "~/components/ui/text";
import { formatCents } from "~/domain/money";
import { clientSchema } from "~/features/clients/schema";
import { createClient, formatAddress, listClients } from "~/features/clients/service";
import { ClientFields } from "~/features/clients/ui/client-form";
import { parseForm, type FieldErrors } from "~/lib/form";
import type { AppHandle } from "~/lib/route-handle";
import { useSearchSheet } from "~/lib/use-search-sheet";
import { cn } from "~/lib/utils";
import { assertSameOrigin, requireUser } from "~/server/session";
import type { Route } from "./+types/_app.clients";

export const handle: AppHandle = { module: "clients", title: "Clients" };

export function meta() {
  return [{ title: "Clients · Insides Interior" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireUser(context.cloudflare.env, request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const archived = url.searchParams.get("archived") === "1";
  const [clients, all] = await Promise.all([
    listClients(ctx, { query, archived }),
    query || archived ? listClients(ctx) : null,
  ]);
  const active = all ?? clients;
  return {
    clients,
    query,
    archived,
    totalActive: active.length,
    totalOutstanding: active.reduce((sum, c) => sum + Math.max(0, c.outstandingCents), 0),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const ctx = await requireUser(context.cloudflare.env, request);
  const parsed = parseForm(clientSchema, await request.formData());
  if (!parsed.ok) return { errors: parsed.errors };
  const id = await createClient(ctx, parsed.data);
  return redirect(`/clients/${id}`);
}

export default function ClientsLayout({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const showDetail = /^\/clients\/[^/]+/.test(pathname);
  const sheet = useSearchSheet("new");
  const actionData = useActionData<{ errors: FieldErrors }>();
  const navigation = useNavigation();
  const creating = navigation.state !== "idle" && navigation.formAction === "/clients";

  const summary =
    loaderData.totalActive === 0
      ? "No clients yet"
      : `${loaderData.totalActive} client${loaderData.totalActive === 1 ? "" : "s"} · ${formatCents(loaderData.totalOutstanding)} outstanding`;

  return (
    <>
      <ModuleHeader
        eyebrow="Clients"
        summary={summary}
        action={
          <Button size="lg" variant="tinted" onClick={() => sheet.show()}>
            <Plus aria-hidden />
            New client
          </Button>
        }
      />
      <SplitView
        showDetail={showDetail}
        list={<ClientList {...loaderData} />}
        detail={<Outlet />}
        emptyDetail={
          <div className="flex h-full min-h-64 items-center justify-center rounded-card border border-dashed border-border p-8 text-center text-secondary">
            Choose a client to see their profile.
          </div>
        }
      />
      <Sheet open={sheet.open} onOpenChange={sheet.onOpenChange}>
        <SheetContent
          title="New client"
          description="Contacts and sites can be added from their profile."
          footer={
            <Button type="submit" form="new-client" size="lg" className="w-full" loading={Boolean(creating)}>
              Save client
            </Button>
          }
        >
          <Form id="new-client" method="post" action="/clients">
            <ClientFields errors={actionData?.errors} />
          </Form>
        </SheetContent>
      </Sheet>
    </>
  );
}

function ClientList({ clients, query, archived, totalActive }: Route.ComponentProps["loaderData"]) {
  const submit = useSubmit();
  const [params] = useSearchParams();
  const navigation = useNavigation();
  const searching = navigation.location?.pathname === "/clients" && navigation.location.search.includes("q=");
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  return (
    <div className="flex flex-col gap-3">
      <Form
        method="get"
        role="search"
        className="flex gap-2"
        onChange={(e) => {
          const form = e.currentTarget;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => submit(form, { replace: true, preventScrollReset: true }), 250);
        }}
      >
        {archived && <input type="hidden" name="archived" value="1" />}
        <label className="relative flex-1">
          <span className="sr-only">Search clients</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-secondary"
            aria-hidden
          />
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search name, email, phone, address"
            className="h-11 w-full rounded-control border border-tertiary bg-surface pr-3 pl-10 text-body placeholder:text-secondary"
            aria-busy={searching || undefined}
          />
        </label>
      </Form>
      <div className="flex items-center justify-between text-label">
        <span className="font-normal text-secondary" aria-live="polite">
          {query
            ? `${clients.length} match${clients.length === 1 ? "" : "es"}`
            : archived
              ? `${clients.length} archived`
              : `${totalActive} active`}
        </span>
        <Link
          to={
            archived
              ? `/clients${query ? `?q=${encodeURIComponent(query)}` : ""}`
              : `/clients?archived=1${query ? `&q=${encodeURIComponent(query)}` : ""}`
          }
          className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-2 font-semibold text-terracotta-ink hover:bg-terracotta-tint"
        >
          <Archive className="size-4" aria-hidden />
          {archived ? "Show active" : "Show archived"}
        </Link>
      </div>

      {clients.length === 0 ? (
        query ? (
          <EmptyState
            icon={Search}
            tone="terracotta"
            title="No matches"
            description={`No clients match “${query}”. Try part of a name, email, phone or street.`}
          />
        ) : archived ? (
          <EmptyState
            icon={Archive}
            tone="terracotta"
            title="Nothing archived"
            description="Archived clients appear here and stay in your reports."
          />
        ) : (
          <EmptyState
            icon={Users}
            tone="terracotta"
            title="No clients yet"
            description="Add the people you design for. You can also create a client right from a new quote."
            action={
              <Button asChild variant="tinted">
                <Link to={`?${new URLSearchParams({ ...Object.fromEntries(params), new: "1" })}`}>
                  <Plus aria-hidden />
                  Add your first client
                </Link>
              </Button>
            }
          />
        )
      ) : (
        <ul
          className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-card"
          aria-label="Clients"
        >
          {clients.map((client) => (
            <li key={client.id}>
              <NavLink
                to={`/clients/${client.id}${params.toString() ? `?${params}` : ""}`}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-16 items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-surface-2",
                    isActive && "bg-terracotta-tint shadow-[inset_3px_0_0_var(--terracotta-base)]",
                  )
                }
              >
                <Avatar name={client.displayName} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{client.displayName}</span>
                  <span className="block truncate text-label font-normal text-secondary">
                    {client.company ??
                      client.email ??
                      (formatAddress(client.billingAddress) || client.phone) ??
                      "No contact details"}
                  </span>
                </span>
                {client.outstandingCents > 0 && (
                  <span className="text-right">
                    <MoneyText cents={client.outstandingCents} className="block font-semibold" />
                    <span className="text-micro text-secondary">outstanding</span>
                  </span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };

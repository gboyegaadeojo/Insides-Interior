import { Outlet, type ShouldRevalidateFunctionArgs, useLoaderData, useRouteLoaderData } from "react-router";
import { AppShell } from "~/components/shell/app-shell";
import { inboxBadge } from "~/features/conversations/service";
import { useAppHandle } from "~/lib/route-handle";
import { requireUser } from "~/server/session";
import type { loader as rootLoader } from "../root";
import type { Route } from "./+types/_app";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireUser(context.cloudflare.env, request);
  const { user } = ctx;
  // FR-MSG-09: threads waiting for the owner, on Inbox in the rail and on More on phone.
  const inboxUnread = await inboxBadge(ctx);
  return { user: { name: user.name, email: user.email, role: user.role }, inboxUnread };
}

/** Opening a thread reads it, so the badge is fetched again on every screen change (one count). */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  return defaultShouldRevalidate || currentUrl.pathname !== nextUrl.pathname;
}

export default function AppLayout() {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const { user, inboxUnread } = useLoaderData<typeof loader>();
  const { module, title } = useAppHandle();
  return (
    <AppShell
      title={title}
      module={module}
      railCollapsed={root?.preferences.railCollapsed ?? false}
      inboxUnread={inboxUnread}
      accountName={user.name}
    >
      <Outlet />
    </AppShell>
  );
}

/** The signed-in user, for any screen inside the app shell. */
export function useCurrentUser() {
  return useRouteLoaderData<typeof loader>("routes/_app")!.user;
}

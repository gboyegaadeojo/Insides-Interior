import { Outlet, useLoaderData, useRouteLoaderData } from "react-router";
import { AppShell } from "~/components/shell/app-shell";
import { useAppHandle } from "~/lib/route-handle";
import { requireUser } from "~/server/session";
import type { loader as rootLoader } from "../root";
import type { Route } from "./+types/_app";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { user } = await requireUser(context.cloudflare.env, request);
  return { user: { name: user.name, email: user.email, role: user.role } };
}

export default function AppLayout() {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const { user } = useLoaderData<typeof loader>();
  const { module, title } = useAppHandle();
  return (
    <AppShell
      title={title}
      module={module}
      railCollapsed={root?.preferences.railCollapsed ?? false}
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

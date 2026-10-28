import { Outlet, useRouteLoaderData } from "react-router";
import { AppShell } from "~/components/shell/app-shell";
import { useAppHandle } from "~/lib/route-handle";
import type { loader as rootLoader } from "../root";

export default function AppLayout() {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const { module, title } = useAppHandle();
  return (
    // Account name becomes the signed-in owner in phase 2.
    <AppShell
      title={title}
      module={module}
      railCollapsed={root?.preferences.railCollapsed ?? false}
      accountName="Insides Interior"
    >
      <Outlet />
    </AppShell>
  );
}

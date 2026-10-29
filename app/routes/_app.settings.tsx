import { ChevronRight } from "lucide-react";
import { RouteErrorBoundary } from "~/components/shell/route-error";
import { NavLink, Outlet, useLocation } from "react-router";
import { groupsFor } from "~/components/settings/groups";
import { SplitView } from "~/components/shell/split-view";
import { IconChip } from "~/components/ui/icon-chip";
import type { AppHandle } from "~/lib/route-handle";
import { cn } from "~/lib/utils";
import { useCurrentUser } from "./_app";

export const handle: AppHandle = { module: "settings", title: "Settings" };

export function meta() {
  return [{ title: "Settings · Insides Interior" }];
}

/** SPEC 6.8 Settings: grouped list on the left (a list screen on phone), form on the right. */
export default function SettingsLayout() {
  const user = useCurrentUser();
  const { pathname } = useLocation();
  const showDetail = pathname !== "/settings" && pathname !== "/settings/";
  const groups = groupsFor(user.role);

  return (
    <SplitView
      showDetail={showDetail}
      list={
        <nav aria-label="Settings sections">
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-card">
            {groups.map((group) => (
              <li key={group.path}>
                <NavLink
                  to={`/settings/${group.path}`}
                  className={({ isActive }) =>
                    cn(
                      "flex min-h-16 items-center gap-3 px-4 py-2 hover:bg-surface-2",
                      isActive && "bg-surface-2",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <IconChip icon={group.icon} tone={group.tone} filled={isActive} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{group.label}</span>
                        <span className="block truncate text-label font-normal text-secondary">
                          {group.description}
                        </span>
                      </span>
                      <ChevronRight className="size-5 text-secondary wide:hidden" aria-hidden />
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      }
      detail={<Outlet />}
      emptyDetail={
        <div className="flex h-full min-h-64 items-center justify-center rounded-card border border-dashed border-border p-8 text-center text-secondary">
          Choose a section to change your settings.
        </div>
      }
    />
  );
}

export { RouteErrorBoundary as ErrorBoundary };

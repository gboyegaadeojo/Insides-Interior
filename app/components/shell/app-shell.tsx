import { Ellipsis, type LucideIcon, PanelLeftClose, PanelLeftOpen, Plus, Search } from "lucide-react";
import * as React from "react";
import { Link, NavLink, useFetcher, useLocation } from "react-router";
import { cn } from "~/lib/utils";
import type { Module } from "~/styles/tokens";
import { Avatar } from "../ui/avatar";
import { CommandPalette, useCommandShortcut } from "./command-palette";
import { type Destination, isActive, MORE, PRIMARY } from "./nav";
import { NewSheet } from "./new-sheet";
import { NotificationsBell } from "./notifications";

// AppShell (SPEC 6.1, 6.2): left rail on tablet and desktop (248px, collapsible
// to 80px; always 80px on tablet portrait), bottom tab bar with a raised + New
// on phone, top bar with title, search, notifications and account. Layout
// responds to width, not device detection (DS-PLT-01). The legacy app-shell,
// sidebar and topbar were referenced for nav order only (SPEC 2.5).

export interface AppShellProps {
  title: string;
  module: Module;
  railCollapsed: boolean;
  /** Unread Inbox count; shown on Inbox and on the phone More tab. */
  inboxUnread?: number;
  /** Unread notifications, on the bell (FR-SYS-02). */
  notificationsUnread?: number;
  accountName: string;
  children: React.ReactNode;
}

export function AppShell({
  title,
  module,
  railCollapsed,
  inboxUnread = 0,
  notificationsUnread = 0,
  accountName,
  children,
}: AppShellProps) {
  const [newOpen, setNewOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const openPalette = React.useCallback(() => setPaletteOpen(true), []);
  useCommandShortcut(openPalette);

  return (
    <div data-module={module} className="min-h-dvh bg-canvas">
      <a
        href="#main"
        className="sr-only z-[70] rounded-control bg-surface px-4 py-3 font-semibold focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Rail collapsed={railCollapsed} inboxUnread={inboxUnread} onNew={() => setNewOpen(true)} />
      <div
        className={cn(
          "flex min-h-dvh flex-col tablet:pl-[var(--rail-collapsed)]",
          !railCollapsed && "wide:pl-[var(--rail-expanded)]",
        )}
      >
        <TopBar
          title={title}
          accountName={accountName}
          notificationsUnread={notificationsUnread}
          onSearch={openPalette}
        />
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1440px] flex-1 px-[var(--gutter)] pt-2 pb-[calc(var(--tabbar-height)+env(safe-area-inset-bottom)+1.5rem)] outline-none tablet:pb-10"
        >
          {children}
        </main>
      </div>
      <TabBar inboxUnread={inboxUnread} onNew={() => setNewOpen(true)} />
      <NewSheet open={newOpen} onOpenChange={setNewOpen} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onNew={() => setNewOpen(true)} />
    </div>
  );
}

function Rail({
  collapsed,
  inboxUnread,
  onNew,
}: {
  collapsed: boolean;
  inboxUnread: number;
  onNew: () => void;
}) {
  const fetcher = useFetcher();
  // Optimistic: reflect the toggle immediately while the cookie is saved.
  const pending = fetcher.formData?.get("railCollapsed");
  const isCollapsed = pending ? pending === "1" : collapsed;
  // `expanded` only applies from tablet landscape up; tablet portrait is always 80px.
  const expanded = !isCollapsed;

  return (
    <nav
      aria-label="Main"
      data-expanded={expanded}
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden w-[var(--rail-collapsed)] flex-col gap-1 overflow-y-auto border-r border-border bg-surface-2 pt-[max(env(safe-area-inset-top),1rem)] pb-4 pl-safe tablet:flex",
        "transition-[width] duration-panel ease-out",
        expanded && "wide:w-[var(--rail-expanded)]",
      )}
    >
      <div className={cn("flex items-center gap-2 px-3 pb-3", expanded && "wide:px-4")}>
        <Link
          to="/"
          className="flex min-h-11 items-center gap-2.5 rounded-control"
          aria-label="Insides Interior home"
        >
          <span
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-[9px] bg-action font-doc text-section font-normal text-action-on"
            aria-hidden
          >
            I
          </span>
          <span
            className={cn(
              "hidden text-body leading-tight font-semibold tracking-tight",
              expanded && "wide:block",
            )}
          >
            Insides Interior
          </span>
        </Link>
      </div>

      <div className={cn("px-3 pb-3", expanded && "wide:px-4")}>
        <button
          type="button"
          onClick={onNew}
          className={cn(
            "flex h-11 w-full items-center justify-center gap-2 rounded-control bg-action font-medium text-action-on transition-[transform,background-color] duration-fast ease-out hover:bg-action/88 active:scale-[0.98] active:duration-press",
          )}
        >
          <Plus className="size-5" aria-hidden />
          <span className={cn("sr-only", expanded && "wide:not-sr-only")}>New</span>
        </button>
      </div>

      <RailList items={PRIMARY} expanded={expanded} inboxUnread={inboxUnread} />
      <div className={cn("mx-3 my-2 border-t border-border", expanded && "wide:mx-4")} />
      <RailList items={MORE} expanded={expanded} inboxUnread={inboxUnread} />

      <fetcher.Form method="post" action="/api/preferences" className="mt-auto hidden px-3 pt-3 wide:block">
        <input type="hidden" name="railCollapsed" value={expanded ? "1" : "0"} />
        <button
          type="submit"
          className={cn(
            "flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-secondary hover:bg-surface-2 hover:text-primary",
            !expanded && "justify-center",
          )}
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          {expanded ? (
            <PanelLeftClose className="size-5" aria-hidden />
          ) : (
            <PanelLeftOpen className="size-5" aria-hidden />
          )}
          {expanded && <span className="text-label">Collapse</span>}
        </button>
      </fetcher.Form>
    </nav>
  );
}

function RailList({
  items,
  expanded,
  inboxUnread,
}: {
  items: Destination[];
  expanded: boolean;
  inboxUnread: number;
}) {
  const { pathname } = useLocation();
  return (
    <ul className={cn("flex flex-col gap-0.5 px-1", expanded && "wide:px-3")}>
      {items.map((item) => {
        const active = isActive(item.to, pathname);
        const unread = item.module === "inbox" ? inboxUnread : 0;
        return (
          <li key={item.to} data-module={item.module}>
            <NavLink
              to={item.to}
              end={item.to === "/"}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-control px-0.5 py-1.5 transition-colors duration-standard",
                expanded && "wide:min-h-11 wide:flex-row wide:justify-start wide:gap-3 wide:px-2",
                active
                  ? "bg-surface text-primary shadow-[0_1px_2px_rgb(0_0_0/6%)]"
                  : "text-primary hover:bg-surface-3/70",
              )}
            >
              <NavIcon icon={item.icon} active={active} />
              <span
                className={cn(
                  "max-w-full truncate text-micro",
                  active && "font-bold",
                  expanded && "wide:text-body",
                  expanded && active && "wide:font-semibold",
                )}
              >
                {item.label}
              </span>
              {unread > 0 && (
                <UnreadBadge
                  count={unread}
                  className={cn("absolute top-1 right-2", expanded && "wide:static wide:ml-auto")}
                />
              )}
            </NavLink>
          </li>
        );
      })}
    </ul>
  );
}

function UnreadBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger-base px-1.5 text-micro font-bold text-danger-on tabular",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
      <span className="sr-only"> unread</span>
    </span>
  );
}

function TopBar({
  title,
  accountName,
  notificationsUnread,
  onSearch,
}: {
  title: string;
  accountName: string;
  notificationsUnread: number;
  onSearch: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 bg-canvas pt-safe">
      <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center gap-2 px-[var(--gutter)]">
        <h1 className="min-w-0 flex-1 truncate font-display text-title font-semibold">{title}</h1>
        <button
          type="button"
          onClick={onSearch}
          className="inline-flex h-11 items-center gap-2 rounded-control border border-border bg-surface px-3 text-secondary hover:text-primary"
          aria-keyshortcuts="Control+K Meta+K"
        >
          <Search className="size-5" aria-hidden />
          <span className="hidden wide:inline">Search</span>
          <kbd className="hidden rounded border border-border px-1.5 text-micro desktop:inline">Ctrl K</kbd>
          <span className="sr-only wide:hidden">Search</span>
        </button>
        <NotificationsBell unread={notificationsUnread} />
        <Link to="/settings" className="rounded-full" aria-label={`Account: ${accountName}`}>
          <Avatar name={accountName} size="md" />
        </Link>
      </div>
    </header>
  );
}

function TabBar({ inboxUnread, onNew }: { inboxUnread: number; onNew: () => void }) {
  const { pathname } = useLocation();
  const [home, quotes, invoices] = [PRIMARY[0]!, PRIMARY[1]!, PRIMARY[2]!];
  const moreActive =
    !isActive(home.to, pathname) && !isActive(quotes.to, pathname) && !isActive(invoices.to, pathname);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-safe tablet:hidden"
    >
      <ul className="mx-auto grid h-[var(--tabbar-height)] max-w-lg grid-cols-5 items-center">
        <TabItem item={home} active={isActive(home.to, pathname)} />
        <TabItem item={quotes} active={isActive(quotes.to, pathname)} />
        <li className="flex justify-center">
          <button
            type="button"
            onClick={onNew}
            className="-mt-7 inline-flex size-16 items-center justify-center rounded-full bg-action text-action-on shadow-sheet ring-4 ring-canvas transition-transform duration-fast ease-out active:scale-95 active:duration-press"
          >
            <Plus className="size-7" aria-hidden />
            <span className="sr-only">New</span>
          </button>
        </li>
        <TabItem item={invoices} active={isActive(invoices.to, pathname)} />
        <li data-module="settings">
          <NavLink
            to="/more"
            aria-current={moreActive ? "page" : undefined}
            className={cn(
              "relative flex h-full min-h-11 flex-col items-center justify-center gap-0.5",
              moreActive ? "text-primary" : "text-secondary",
            )}
          >
            <span
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-lg [&_svg]:size-4.5",
                moreActive && "text-accent",
              )}
              aria-hidden
            >
              <Ellipsis />
            </span>
            <span className={cn("text-micro", moreActive && "font-bold")}>More</span>
            {inboxUnread > 0 && (
              <UnreadBadge count={inboxUnread} className="absolute top-0.5 right-[calc(50%-1.75rem)]" />
            )}
          </NavLink>
        </li>
      </ul>
    </nav>
  );
}

function TabItem({ item, active }: { item: Destination; active: boolean }) {
  return (
    <li data-module={item.module}>
      <NavLink
        to={item.to}
        end={item.to === "/"}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-full min-h-11 flex-col items-center justify-center gap-0.5",
          active ? "text-primary" : "text-secondary",
        )}
      >
        <NavIcon icon={item.icon} active={active} />
        <span className={cn("text-micro", active && "font-bold")}>{item.label}</span>
      </NavLink>
    </li>
  );
}

/** Navigation icon: quiet when idle, bronze when it's the current page. */
function NavIcon({ icon: Icon, active }: { icon: LucideIcon; active: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center [&_svg]:size-4.5",
        active ? "text-accent" : "text-tertiary",
      )}
    >
      <Icon strokeWidth={active ? 2.1 : 1.8} />
    </span>
  );
}

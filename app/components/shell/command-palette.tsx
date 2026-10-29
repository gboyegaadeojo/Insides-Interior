import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import {
  FileText,
  LoaderCircle,
  Monitor,
  Moon,
  Plus,
  Receipt,
  Search,
  Sun,
  UserPlus,
  Users,
} from "lucide-react";
import * as React from "react";
import { useFetcher, useNavigate, useSubmit } from "react-router";
import { formatCents } from "~/domain/money";
import { applyTheme, type ThemePreference } from "~/lib/preferences";
import { DialogOverlay } from "../ui/dialog";
import { useRestoreFocus } from "../ui/sheet";
import { IconChip } from "../ui/icon-chip";
import { StatusBadge, type Status } from "../ui/status-badge";
import { ALL_DESTINATIONS } from "./nav";

// Command palette (SPEC 5.12 FR-SYS-01, DS-NAV-06): records (clients, quotes,
// invoices by number, name or amount, searched on the server), actions and
// destinations. Nothing destructive lives here, so nothing needs confirming.
// Legacy command-palette.tsx was referenced for the cmdk structure (SPEC 2.5).

interface Hit {
  kind: "client" | "quote" | "invoice";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  status?: string;
  totalCents?: number | null;
}

const KIND = {
  client: { icon: Users, tone: "terracotta", heading: "Clients" },
  quote: { icon: FileText, tone: "plum", heading: "Quotes" },
  invoice: { icon: Receipt, tone: "indigo", heading: "Invoices" },
} as const;

const groupClass =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-label [&_[cmdk-group-heading]]:text-secondary";
const itemClass =
  "flex min-h-12 cursor-pointer items-center gap-3 rounded-control px-3 py-2 data-[selected=true]:bg-surface-2";

/** Static commands filter on the client; `keywords` are extra words that match. */
function matches(query: string, label: string, keywords = "") {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const text = `${label} ${keywords}`.toLowerCase();
  return q.split(/\s+/).every((word) => text.includes(word));
}

export function CommandPalette({
  open,
  onOpenChange,
  onNew,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNew: () => void;
}) {
  const navigate = useNavigate();
  const submit = useSubmit();
  const fetcher = useFetcher();
  const search = useFetcher<{ query: string; hits: Hit[] }>();
  const restore = useRestoreFocus();
  const [query, setQuery] = React.useState("");

  // Records: ask the server 150 ms after typing stops (2+ characters).
  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const timer = setTimeout(() => search.load(`/api/search?q=${encodeURIComponent(q)}`), 150);
    return () => clearTimeout(timer);
    // search.load is stable enough for this; including it would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) setQuery("");
  }

  function run(fn: () => void) {
    close(false);
    fn();
  }

  function setTheme(theme: ThemePreference) {
    run(() => {
      applyTheme(theme);
      fetcher.submit({ theme }, { method: "post", action: "/api/preferences" });
    });
  }

  const trimmed = query.trim();
  const hits = trimmed.length >= 2 && search.data?.query === trimmed ? search.data.hits : [];
  const searching = trimmed.length >= 2 && (search.state !== "idle" || search.data?.query !== trimmed);
  const actions = [
    {
      label: "New quote",
      keywords: "create add",
      icon: FileText,
      tone: "plum" as const,
      onSelect: () => run(() => submit(null, { method: "post", action: "/quotes" })),
    },
    {
      label: "New invoice",
      keywords: "create add bill",
      icon: Receipt,
      tone: "indigo" as const,
      onSelect: () => run(() => submit(null, { method: "post", action: "/invoices" })),
    },
    {
      label: "New client",
      keywords: "create add contact",
      icon: UserPlus,
      tone: "terracotta" as const,
      onSelect: () => run(() => navigate("/clients?new=1")),
    },
    {
      label: "New…",
      keywords: "create payment expense",
      icon: Plus,
      tone: "teal" as const,
      onSelect: () => run(onNew),
    },
    {
      label: "Light appearance",
      keywords: "theme",
      icon: Sun,
      tone: "saffron" as const,
      onSelect: () => setTheme("light"),
    },
    {
      label: "Dark appearance",
      keywords: "theme",
      icon: Moon,
      tone: "indigo" as const,
      onSelect: () => setTheme("dark"),
    },
    {
      label: "Match system appearance",
      keywords: "theme",
      icon: Monitor,
      tone: "ocean" as const,
      onSelect: () => setTheme("system"),
    },
  ].filter((a) => matches(query, a.label, a.keywords));
  const destinations = ALL_DESTINATIONS.filter((d) => matches(query, d.label, `go to open ${d.module}`));
  const nothing = hits.length === 0 && actions.length === 0 && destinations.length === 0 && !searching;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={close}>
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPrimitive.Content
          onOpenAutoFocus={restore.onOpenAutoFocus}
          onCloseAutoFocus={restore.onCloseAutoFocus}
          className="fixed top-[10dvh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-sheet border border-border bg-surface text-primary shadow-sheet data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          <DialogPrimitive.Title className="sr-only">Search and commands</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search clients, quotes and invoices by name, number or amount, or run a command. Use arrow keys to
            move and Enter to choose.
          </DialogPrimitive.Description>
          <Command label="Search and commands" loop shouldFilter={false}>
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="size-5 text-secondary" aria-hidden />
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder="Search clients, quotes, invoices, or a command…"
                className="h-14 flex-1 bg-transparent text-body outline-none placeholder:text-secondary"
              />
              {searching && (
                <LoaderCircle className="size-5 animate-spin text-secondary" aria-label="Searching" />
              )}
            </div>
            <Command.List className="max-h-[60dvh] overflow-y-auto p-2" aria-live="polite">
              {nothing && (
                <p className="px-3 py-6 text-center text-secondary">
                  No matches for “{trimmed}”. Try a number like Q-1042, a client's name or an amount.
                </p>
              )}
              {(["client", "quote", "invoice"] as const).map((kind) => {
                const group = hits.filter((h) => h.kind === kind);
                if (group.length === 0) return null;
                const { icon, tone, heading } = KIND[kind];
                return (
                  <Command.Group key={kind} heading={heading} className={groupClass}>
                    {group.map((hit) => (
                      <Command.Item
                        key={hit.id}
                        value={`${kind}-${hit.id}`}
                        className={itemClass}
                        onSelect={() => run(() => navigate(hit.href))}
                      >
                        <IconChip icon={icon} tone={tone} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{hit.title}</span>
                          <span className="block truncate text-label text-secondary">{hit.subtitle}</span>
                        </span>
                        {typeof hit.totalCents === "number" && (
                          <span className="hidden text-label tabular tablet:inline">
                            {formatCents(hit.totalCents)}
                          </span>
                        )}
                        {hit.status && <StatusBadge status={hit.status as Status} size="sm" />}
                      </Command.Item>
                    ))}
                  </Command.Group>
                );
              })}
              {actions.length > 0 && (
                <Command.Group heading="Actions" className={groupClass}>
                  {actions.map((a) => (
                    <Command.Item key={a.label} value={a.label} className={itemClass} onSelect={a.onSelect}>
                      <IconChip icon={a.icon} tone={a.tone} size="sm" filled={a.label === "New…"} />
                      {a.label}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {destinations.length > 0 && (
                <Command.Group heading="Go to" className={groupClass}>
                  {destinations.map((d) => (
                    <Command.Item
                      key={d.to}
                      value={`go ${d.label}`}
                      className={itemClass}
                      onSelect={() => run(() => navigate(d.to))}
                    >
                      <IconChip icon={d.icon} tone={d.tone} size="sm" />
                      {d.label}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Cmd/Ctrl+K opens the palette (DS-NAV-06). */
export function useCommandShortcut(onOpen: () => void) {
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpen();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpen]);
}

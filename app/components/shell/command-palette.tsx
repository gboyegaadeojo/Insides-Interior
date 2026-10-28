import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { Monitor, Moon, Plus, Search, Sun } from "lucide-react";
import * as React from "react";
import { useFetcher, useNavigate } from "react-router";
import { applyTheme, type ThemePreference } from "~/lib/preferences";
import { DialogOverlay } from "../ui/dialog";
import { useRestoreFocus } from "../ui/sheet";
import { IconChip } from "../ui/icon-chip";
import { ALL_DESTINATIONS } from "./nav";

// DS-NAV-06 shell: actions and destinations now; records join in phase 8.
// Legacy command-palette.tsx was referenced for the cmdk structure (SPEC 2.5).

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
  const fetcher = useFetcher();
  const restore = useRestoreFocus();

  function run(fn: () => void) {
    onOpenChange(false);
    fn();
  }

  function setTheme(theme: ThemePreference) {
    run(() => {
      applyTheme(theme);
      fetcher.submit({ theme }, { method: "post", action: "/api/preferences" });
    });
  }

  const itemClass =
    "flex min-h-12 cursor-pointer items-center gap-3 rounded-control px-3 py-2 data-[selected=true]:bg-surface-2";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPrimitive.Content
          onOpenAutoFocus={restore.onOpenAutoFocus}
          onCloseAutoFocus={restore.onCloseAutoFocus}
          className="fixed top-[10dvh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-sheet border border-border bg-surface text-primary shadow-sheet data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          <DialogPrimitive.Title className="sr-only">Search and commands</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Type to search destinations and actions. Use arrow keys to move and Enter to choose.
          </DialogPrimitive.Description>
          <Command label="Search and commands" loop>
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="size-5 text-secondary" aria-hidden />
              <Command.Input
                autoFocus
                placeholder="Search or jump to…"
                className="h-14 flex-1 bg-transparent text-body outline-none placeholder:text-secondary"
              />
            </div>
            <Command.List className="max-h-[60dvh] overflow-y-auto p-2" aria-live="polite">
              <Command.Empty className="px-3 py-6 text-center text-secondary">No matches</Command.Empty>
              <Command.Group
                heading="Actions"
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-label [&_[cmdk-group-heading]]:text-secondary"
              >
                <Command.Item className={itemClass} onSelect={() => run(onNew)}>
                  <IconChip icon={Plus} tone="teal" size="sm" filled />
                  New…
                </Command.Item>
                <Command.Item
                  className={itemClass}
                  value="theme light appearance"
                  onSelect={() => setTheme("light")}
                >
                  <IconChip icon={Sun} tone="saffron" size="sm" />
                  Light appearance
                </Command.Item>
                <Command.Item
                  className={itemClass}
                  value="theme dark appearance"
                  onSelect={() => setTheme("dark")}
                >
                  <IconChip icon={Moon} tone="indigo" size="sm" />
                  Dark appearance
                </Command.Item>
                <Command.Item
                  className={itemClass}
                  value="theme system appearance"
                  onSelect={() => setTheme("system")}
                >
                  <IconChip icon={Monitor} tone="ocean" size="sm" />
                  Match system appearance
                </Command.Item>
              </Command.Group>
              <Command.Group
                heading="Go to"
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-label [&_[cmdk-group-heading]]:text-secondary"
              >
                {ALL_DESTINATIONS.map((d) => (
                  <Command.Item key={d.to} className={itemClass} onSelect={() => run(() => navigate(d.to))}>
                    <IconChip icon={d.icon} tone={d.tone} size="sm" />
                    {d.label}
                  </Command.Item>
                ))}
              </Command.Group>
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

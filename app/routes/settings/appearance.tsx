import { Check, Monitor, Moon, PartyPopper, Sun } from "lucide-react";
import { useFetcher, useLocation, useRouteLoaderData } from "react-router";
import { SectionHeader } from "~/components/settings/section-header";
import { Card, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { IconChip } from "~/components/ui/icon-chip";
import { applyTheme, type ThemePreference, THEMES } from "~/lib/preferences";
import { cn } from "~/lib/utils";
import type { loader as rootLoader } from "../../root";

const THEME_LABEL: Record<ThemePreference, { label: string; icon: typeof Sun }> = {
  light: { label: "Light", icon: Sun },
  dark: { label: "Dark", icon: Moon },
  system: { label: "System", icon: Monitor },
};

/** FR-SET-10: per device, applied before first paint (cookie read by the root loader). */
export default function AppearanceSettings() {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const fetcher = useFetcher();
  const { pathname } = useLocation();
  const pendingTheme = fetcher.formData?.get("theme") as ThemePreference | undefined;
  const theme = pendingTheme ?? root?.preferences.theme ?? "system";
  const pendingCelebrate = fetcher.formData?.get("celebrations");
  const celebrations = pendingCelebrate ? pendingCelebrate === "1" : (root?.preferences.celebrations ?? true);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Appearance" description="These apply on this device." />
      <Card>
        <CardHeader>
          <CardTitle>Theme</CardTitle>
          <CardDescription>System follows your device's light or dark setting.</CardDescription>
        </CardHeader>
        <fetcher.Form method="post" action="/api/preferences">
          <input type="hidden" name="redirectTo" value={pathname} />
          <fieldset>
            <legend className="sr-only">Theme</legend>
            <div className="grid grid-cols-3 gap-3">
              {THEMES.map((value) => {
                const { label, icon } = THEME_LABEL[value];
                const selected = theme === value;
                return (
                  <button
                    key={value}
                    type="submit"
                    name="theme"
                    value={value}
                    aria-pressed={selected}
                    onClick={() => applyTheme(value)}
                    className={cn(
                      "flex flex-col gap-2 rounded-card border-2 p-2 text-left transition-colors duration-standard",
                      selected ? "border-teal-base" : "border-border hover:border-tertiary",
                    )}
                  >
                    <ThemePreview theme={value} />
                    <span className="flex min-h-8 items-center gap-1.5 px-1 font-semibold">
                      <IconChip icon={icon} tone="teal" size="sm" filled={selected} />
                      {label}
                      {selected && <Check className="ml-auto size-4 text-teal-base" aria-hidden />}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        </fetcher.Form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Celebrations</CardTitle>
          <CardDescription>
            A short stamp and confetti when a client approves a quote or an invoice is paid. Always skipped
            when your device asks for reduced motion.
          </CardDescription>
        </CardHeader>
        <fetcher.Form method="post" action="/api/preferences">
          <input type="hidden" name="redirectTo" value={pathname} />
          <button
            type="submit"
            name="celebrations"
            value={celebrations ? "0" : "1"}
            role="switch"
            aria-checked={celebrations}
            className="flex min-h-11 w-full items-center gap-3 rounded-control"
          >
            <IconChip icon={PartyPopper} tone="saffron" />
            <span className="flex-1 text-left font-semibold">Show celebrations</span>
            <span
              aria-hidden
              className={cn(
                "relative h-8 w-13 rounded-full transition-colors duration-standard",
                celebrations ? "bg-teal-base" : "bg-surface-3",
              )}
            >
              <span
                className={cn(
                  "absolute top-1 left-1 size-6 rounded-full bg-surface shadow-card transition-transform duration-standard ease-out",
                  celebrations && "translate-x-5",
                )}
              />
            </span>
          </button>
        </fetcher.Form>
      </Card>
    </div>
  );
}

/** Miniature app preview in the given theme (SPEC 6.8 Settings, Appearance). */
function ThemePreview({ theme }: { theme: ThemePreference }) {
  const pane = (mode: "light" | "dark") => (
    <div data-theme={mode} className="flex h-full gap-1 bg-canvas p-1.5">
      <div className="w-3 rounded-sm bg-surface" />
      <div className="flex flex-1 flex-col gap-1">
        <div className="h-3 rounded-sm bg-plum-tint" />
        <div className="flex-1 rounded-sm bg-surface" />
      </div>
    </div>
  );
  return (
    <div className="h-16 overflow-hidden rounded-control border border-border" aria-hidden>
      {theme === "system" ? (
        <div className="grid h-full grid-cols-2">
          {pane("light")}
          {pane("dark")}
        </div>
      ) : (
        pane(theme)
      )}
    </div>
  );
}

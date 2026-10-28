// Per-device UI preferences kept in cookies so the server renders the right
// theme before first paint (no flash). Not account settings; those live in D1
// from phase 2.

export const THEMES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEMES)[number];

export interface Preferences {
  theme: ThemePreference;
  railCollapsed: boolean;
  celebrations: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = { theme: "system", railCollapsed: false, celebrations: true };

const COOKIE = { theme: "ii_theme", railCollapsed: "ii_rail", celebrations: "ii_celebrate" } as const;
const ONE_YEAR = 60 * 60 * 24 * 365;

function readCookies(header: string | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) map.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
  }
  return map;
}

export function readPreferences(cookieHeader: string | null): Preferences {
  const cookies = readCookies(cookieHeader);
  const theme = cookies.get(COOKIE.theme);
  return {
    theme: THEMES.includes(theme as ThemePreference) ? (theme as ThemePreference) : DEFAULT_PREFERENCES.theme,
    railCollapsed: cookies.get(COOKIE.railCollapsed) === "1",
    celebrations: cookies.get(COOKIE.celebrations) !== "0",
  };
}

/** Applies a theme immediately, before the cookie round trip finishes. */
export function applyTheme(theme: ThemePreference) {
  document.documentElement.dataset.theme = theme;
}

/** Validates form input and returns Set-Cookie headers for the changed preferences. */
export function preferenceCookies(form: FormData, secure: boolean): string[] {
  const attrs = `Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax${secure ? "; Secure" : ""}`;
  const cookies: string[] = [];
  const theme = form.get("theme");
  if (typeof theme === "string" && THEMES.includes(theme as ThemePreference)) {
    cookies.push(`${COOKIE.theme}=${theme}; ${attrs}`);
  }
  const rail = form.get("railCollapsed");
  if (rail === "1" || rail === "0") cookies.push(`${COOKIE.railCollapsed}=${rail}; ${attrs}`);
  const celebrate = form.get("celebrations");
  if (celebrate === "1" || celebrate === "0") cookies.push(`${COOKIE.celebrations}=${celebrate}; ${attrs}`);
  return cookies;
}

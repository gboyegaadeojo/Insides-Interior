import * as React from "react";

/**
 * Whether a media query matches. The server (and the first browser render)
 * assume `serverValue`, so hydration matches; the real value follows at once.
 */
export function useMediaQuery(query: string, serverValue = true): boolean {
  return React.useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

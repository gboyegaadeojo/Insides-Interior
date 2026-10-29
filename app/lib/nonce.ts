import * as React from "react";

/**
 * The CSP nonce for this page's inline scripts, provided by entry.server. In
 * the browser it's empty: scripts that need it have already run, and browsers
 * hide nonce attributes after parsing.
 */
export const NonceContext = React.createContext<string | undefined>(undefined);

export function useNonce() {
  return React.useContext(NonceContext);
}

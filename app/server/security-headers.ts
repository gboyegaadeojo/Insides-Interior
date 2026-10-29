// Security headers (SPEC 11.1 "strict CSP"). Pages get a Content-Security-
// Policy with a per-request nonce for React Router's inline scripts; every
// response gets the baseline headers. Styles allow 'unsafe-inline' because
// components set style attributes (chart geometry, progress widths); scripts
// never run inline without the nonce.

export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function contentSecurityPolicy(nonce: string, opts: { https: boolean }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    // data: for inline SVG samples, blob: for receipt previews before upload.
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(opts.https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** Headers for every response; set only where the route hasn't chosen its own. */
export function baselineHeaders(opts: { https: boolean }): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    // Portal links carry their token in the path; never send it to another site.
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    ...(opts.https ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
  };
}

export function withBaselineHeaders(response: Response, https: boolean): Response {
  // Redirects and some platform responses have immutable headers; copy them.
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(baselineHeaders({ https }))) {
    if (!out.headers.has(name)) out.headers.set(name, value);
  }
  return out;
}

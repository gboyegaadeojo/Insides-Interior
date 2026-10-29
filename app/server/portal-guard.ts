// Portal request guards (SPEC 11.1): 30 requests a minute per IP on /q and /i,
// and the visitor details recorded with approvals and views.

import type { VisitorMeta } from "~/features/portal/service";

export function visitorMeta(request: Request): VisitorMeta {
  return {
    ip: request.headers.get("CF-Connecting-IP"),
    userAgent: request.headers.get("User-Agent"),
  };
}

/**
 * Throws 429 when an IP goes over the limit. Off in local development, where
 * the whole Playwright suite shares one IP.
 */
export async function limitPortal(env: Env, request: Request) {
  if (env.APP_ENV === "development" || env.APP_ENV === "test") return;
  const limiter = (env as Env & { PORTAL_LIMITER?: RateLimit }).PORTAL_LIMITER;
  if (!limiter) return;
  const key = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const { success } = await limiter.limit({ key });
  if (!success) {
    throw new Response("Too many requests. Please wait a minute and try again.", {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  }
}

/** Portal pages carry a token in the URL: keep them out of caches, indexes and Referer headers. */
export const PORTAL_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

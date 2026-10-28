# Decisions

Project decisions that are not obvious from the code. SPEC 15.3 holds the product-level log; this file holds
build-level calls (salvage map calls under SPEC 2.5, vendor deviations, spike results).

| Date       | Decision                                                                                                                                                                                                                                                                | Rationale                                                                                                                                                                                                                                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-24 | **Email goes through one interface in `app/server/email/`.** `createEmailTransport(env)` returns the Resend transport only when `RESEND_API_KEY` is set; otherwise a dev transport prints each email's recipients, subject and links to the terminal and sends nothing. | No domain or Resend account yet. Magic links and portal links can be tested by clicking them in the `npm run dev` log. Turning on real email is `npx wrangler secret put RESEND_API_KEY` (plus `.dev.vars` locally).                                                                                                      |
| 2026-10-24 | **Resend domain verification skipped for now.** `EMAIL_FROM` is Resend's shared `onboarding@resend.dev` sender.                                                                                                                                                         | Resend only delivers from that sender to the account owner's own address, so it's fine for testing and not for clients. Before launch: buy the domain, verify `mail.<domain>` (SPEC 9.1–9.2), change `EMAIL_FROM`.                                                                                                        |
| 2026-10-24 | **Hosted on `insides-interior.<subdomain>.workers.dev`; no custom domain.**                                                                                                                                                                                             | No domain bought yet. `app.<domain>` (SPEC 9.1) is a Workers custom-domain route added later; nothing in the code assumes the host name.                                                                                                                                                                                  |
| 2026-10-24 | **React Router 7.18 (not 8.x).**                                                                                                                                                                                                                                        | SPEC 7.1 names v7 framework mode. v8 is out but changes defaults; upgrading is a separate, deliberate step.                                                                                                                                                                                                               |
| 2026-10-24 | **TypeScript 6.0, Vitest 4.1, Vite 7.**                                                                                                                                                                                                                                 | typescript-eslint 8.72 supports TypeScript < 6.1; the Workers Vitest plugin supports Vitest 4.1+; Vite 7 is supported by every plugin in use.                                                                                                                                                                             |
| 2026-10-24 | **R2 buckets `insides-files`, `insides-backups`; queue `insides-jobs`** (SPEC writes them with underscores).                                                                                                                                                            | Cloudflare only allows lowercase letters, digits and hyphens in R2 bucket and queue names. The D1 database keeps `insides_db`.                                                                                                                                                                                            |
| 2026-10-24 | **`@cloudflare/vitest-plugin` instead of `@cloudflare/vitest-pool-workers`.**                                                                                                                                                                                           | The pool package was renamed and no longer receives updates.                                                                                                                                                                                                                                                              |
| 2026-10-24 | **First migration is a `SELECT 1` no-op.**                                                                                                                                                                                                                              | D1 rejects a migration with no statements; tables arrive in phase 2.                                                                                                                                                                                                                                                      |
| 2026-10-24 | **Fonts come from `@fontsource/fraunces` and `@fontsource/inter` (WOFF2, latin subset) for now.**                                                                                                                                                                       | Self-hosted and bundled by Vite, so Browser Rendering loads them from our origin. Phase 1 decides the final weights and axes.                                                                                                                                                                                             |
| 2026-10-24 | **Preview deploys are Worker preview versions (`wrangler versions upload --preview-alias pr-<n>`).**                                                                                                                                                                    | Free, one per PR, URL `pr-<n>-insides-interior.<subdomain>.workers.dev`. Caveat: preview versions share the production bindings (D1, R2). That is harmless while there is no data; before phase 2 writes real data, previews need their own D1 and R2 (a `preview` Wrangler environment) seeded with fake data (SPEC 13). |
| 2026-10-24 | **legacy/ is excluded from tsconfig, ESLint, Prettier, Vitest (tests only live in `tests/`) and the Vite dev watcher.** Nothing in legacy/ was deleted; the "Delete" rows of SPEC 2.5 are applied by not porting those files.                                           | SPEC 14.4, phase 0.                                                                                                                                                                                                                                                                                                       |

## PDF spike (SPEC 10.4)

**Setup.** `/spike/pdf-sample` renders a static 3-page quote (Letter, five rooms, 46 lines, Fraunces
headings, Inter body, SVG logo, CSS page breaks). `/spike/pdf?key=<SPIKE_KEY>` gets a browser from Browser
Rendering through `@cloudflare/puppeteer` (reconnecting to an idle session if one exists, otherwise launching
one with `keep_alive` of 10 minutes), waits for `load` and `document.fonts.ready`, prints with `page.pdf()`,
stores the file in R2 at `pdf/spike/1/<sha256>.pdf` and returns the PDF (timings in `Server-Timing`).
`&format=json` returns the timings, whether the browser was reused, page count, byte size and loaded fonts.

**Result (2026-10-28, Workers Free, production `insides-interior.insides-interior.workers.dev`).**
**Decision: keep Browser Rendering as the primary PDF path.** The `@react-pdf/renderer` fallback is not needed.

| Run                      | Browser | Get browser | Load + fonts | Print       | R2 put      | Total         |
| ------------------------ | ------- | ----------- | ------------ | ----------- | ----------- | ------------- |
| Cold (first of the day)  | new     | 1.1 s       | 9.5 s        | 0.4 s       | 0.3 s       | 11.4 s        |
| Cold (other runs)        | new     | 1.4–3.6 s   | 1.4–1.7 s    | 0.7–1.0 s   | 0.4–0.6 s   | 3.7–7.0 s     |
| Warm (7 runs, 5 s apart) | reused  | 0.28–0.42 s | 0.56–0.82 s  | 0.31–0.42 s | 0.29–0.37 s | **1.5–1.9 s** |

- Output: 3 Letter pages, 115 KB, Skia/PDF. Fraunces SemiBold, Inter Regular and Inter SemiBold are embedded
  as subset TrueType with `ToUnicode` maps, so text is selectable and searchable; no rasterised text.
- Under 5 s: met with a warm browser every time; a cold start exceeded it 2 times out of 4. That's acceptable
  because PDFs render off the request path (queue at send time, SPEC 9.3) and are cached in R2, so the owner
  never waits on a cold start. Re-downloads are an R2 read.
- **Limits hit.** On Workers Free, launching new browsers back-to-back returned errors after the first launch
  (new-browser rate limit). Reusing sessions avoids it; the spike now answers 429 with `Retry-After` instead
  of a 500. The free plan also caps daily browser time and concurrent browsers (verify current numbers in
  Cloudflare's Browser Rendering limits page before launch); at well under 100 documents a month this is
  far inside the allowance. Phase 5 must: reuse sessions, render from the queue consumer with retries, and
  treat 429 as retryable.
- **PDF bytes differ per render** (creation timestamp), so the R2 cache key's `content_hash` must hash the
  revision's content, not the PDF bytes (SPEC 10.4 caching).
- **Logo gotcha.** Text inside an SVG loaded with `<img>` can't use web fonts; the sample logo's words fell back
  to Liberation Serif/Sans. Logos uploaded in settings (phase 2) should be PNG, or SVG with text converted to
  outlines; the settings screen should say so.
- First load after deploy was slow (9.5 s) because the Worker, its assets and the font files were all cold;
  `?print=1` routes in phase 5 should inline critical CSS and preload the two fonts.

**Local development.** Under `wrangler`/`vite dev` on Windows the local Browser Rendering shim launches a
downloaded Chrome (about 0.4 s) and loads the page, but `page.pdf()` never returns, even with a 120 s
timeout. The spike must therefore run against the deployed Worker. Real PDFs aren't needed locally until
phase 5; if they still hang then, phase 5 adds a dev-only fallback.

# Insides Interior — Quotes & Invoicing

Rebuild of the Insides Interior Limited quotes and invoicing app. The spec is [docs/SPEC.md](docs/SPEC.md);
rules for Claude Code are in [CLAUDE.md](CLAUDE.md); build decisions are in [docs/decisions.md](docs/decisions.md).
The old app lives in [legacy/](legacy/) for reference only.

## Run it locally (Windows or macOS/Linux)

Requires Node 22+ (24 recommended).

```sh
npm install
copy .dev.vars.example .dev.vars    # macOS/Linux: cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run db:seed:local -- --owner-email you@example.com --owner-name "Your Name"
npm run dev
```

Open http://localhost:5173 and sign in with that email. Locally no email is sent: the sign-in link is printed
in the terminal running `npm run dev`; open it in the browser. Bindings (D1, R2, Queues) run locally through
Miniflare; nothing touches Cloudflare.

## Commands

| Command                                          | What it does                                                                                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                    | Dev server with hot reload                                                                                                                                            |
| `npm run check`                                  | Types, lint, formatting, unit + integration tests (100% domain coverage), production build                                                                            |
| `npm run test:e2e`                               | Playwright on iPad Pro 11, iPad Mini, iPhone 14, Pixel 7, Desktop 1440 (first run: `npx playwright install chromium webkit` and `node scripts/seed.ts --local --e2e`) |
| `npm run db:generate`                            | Generate a migration from `app/server/db/schema.ts`                                                                                                                   |
| `npm run db:migrate:local` / `db:migrate:remote` | Apply migrations to local / production D1                                                                                                                             |
| `npm run db:seed:local` / `db:seed:remote`       | Create the business, GST/PST, numbering and the owner (`--owner-email`); safe to re-run                                                                               |
| `npm run tokens` / `npm run icons`               | Regenerate `app/styles/tokens.css` / the PWA icons                                                                                                                    |
| `npm run deploy`                                 | Build and deploy to Cloudflare (CI does this on merge to `main`)                                                                                                      |

## Deploys

- Pull requests: CI runs `npm run check`, migrates and seeds the separate preview database, uploads a preview
  version at `https://pr-<number>-insides-interior-preview.insides-interior.workers.dev` and runs Playwright against it.
- `main`: CI runs `npm run check`, applies D1 migrations and deploys to https://insides-interior.insides-interior.workers.dev.
- Repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `E2E_SECRET`.
- Worker secrets (`npx wrangler secret put <NAME>`, add `--env preview` for previews): see `.dev.vars.example`.

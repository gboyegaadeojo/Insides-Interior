# Runbook

How to deploy, roll back, restore data, rotate keys and move the old app's records in, for
Insides Interior (SPEC 11.3, 12, 14.4 phase 10). Commands run from the repository root with
`npx wrangler` signed in to the Insides Interior Cloudflare account (`npx wrangler whoami`).

| Thing            | Where                                                                             |
| ---------------- | --------------------------------------------------------------------------------- |
| Live app         | https://insides-interior.insides-interior.workers.dev (Worker `insides-interior`) |
| PR previews      | `pr-<n>-insides-interior-preview.insides-interior.workers.dev`                    |
| Database         | D1 `insides_db` (preview: `insides_db_preview`)                                   |
| Files            | R2 `insides-files` (private; signed links only)                                   |
| Backups          | R2 `insides-backups`: `daily/` kept 90 days, `monthly/` kept 7 years              |
| Jobs             | Queue `insides-jobs`; crons 07:00 UTC daily, 06:30 UTC Monday (Lagos is UTC+1)    |
| Recovery targets | Lose at most 24 hours of data (RPO), back online within 4 hours (RTO)             |

## Deploy

Merging a pull request into `main` deploys automatically (`.github/workflows/deploy.yml`): it runs
`npm run check`, applies new D1 migrations, then deploys the Worker. Watch it with
`gh run list --workflow deploy.yml`.

By hand, from an up-to-date `main`:

```sh
npm run check
npm run db:migrate:remote   # applies only migrations not yet applied
npm run deploy
curl -s https://insides-interior.insides-interior.workers.dev/health   # {"status":"ok",…}
```

Migrations are forward-only. Write each so the previous Worker version still runs against the new
schema (add columns and tables; don't rename or drop in the same release). That keeps a rollback
safe.

## Roll back the app

```sh
npx wrangler deployments list          # recent deployments, newest first
npx wrangler rollback <version-id>     # back to a known-good version; takes effect in seconds
```

A rollback changes code only, never data. Then fix forward on a branch and merge as usual (the
next deploy replaces the rolled-back version).

## Restore data

Decide first how far back to go, and write down the time. Restoring replaces everything written
after that point, so tell the owner which quotes, invoices or payments to re-enter.

### From D1 Time Travel (the last 7 days on the free plan, to the minute)

```sh
npx wrangler d1 time-travel info insides_db                                   # current bookmark (note it: it is the undo)
npx wrangler d1 time-travel restore insides_db --timestamp=2026-10-29T08:30:00Z
```

Time Travel restores the database in place. Undo a wrong restore with
`npx wrangler d1 time-travel restore insides_db --bookmark=<the bookmark you noted>`.

### From a nightly dump in R2 (older than Time Travel, or if Time Travel is unavailable)

```sh
npx wrangler r2 object get insides-backups/daily/2026-10-28.sql.gz --remote --file restore.sql.gz
gunzip restore.sql.gz
npx wrangler d1 create insides_db_restore                       # a fresh, empty database
npx wrangler d1 execute insides_db_restore --remote --file restore.sql
npx wrangler d1 execute insides_db_restore --remote --command "select count(*) from invoice"
```

Check the restored figures in the app's terms (invoice count, latest invoice number, outstanding
total). Then point the Worker at it: put the new `database_id` (from `d1 create`) in the `DB`
binding in `wrangler.jsonc`, open a pull request and merge it (or `npm run deploy`). Keep the old
database until the owner confirms everything looks right, then delete it with
`npx wrangler d1 delete insides_db`.

Monthly dumps are in `monthly/YYYY-MM.sql.gz`.

### Backups themselves

`.github/workflows/backup.yml` exports the database every night at 01:30 UTC with
`wrangler d1 export` and uploads it to `insides-backups`. Run it on demand from GitHub (Actions →
Nightly backup → Run workflow) or by hand:

```sh
npx wrangler d1 export insides_db --remote --output backup.sql && gzip -9 backup.sql
npx wrangler r2 object put "insides-backups/daily/$(date +%F).sql.gz" --file backup.sql.gz --remote
```

If the newest daily backup is more than 2 days old, the app's daily job puts a "Backups have
stopped" notification in every owner's bell. The usual cause: GitHub turns off scheduled
workflows in a public repository after 60 days without activity. Re-enable it under Actions →
Nightly backup, and check that the `CLOUDFLARE_API_TOKEN` repository secret is still valid (it
needs D1 and R2 edit permission).

Retention is R2 lifecycle rules (`npx wrangler r2 bucket lifecycle list insides-backups`):
`daily-90-days` and `monthly-7-years`.

**Restore drill, every quarter (SPEC 11.3):** restore last night's dump into a new database as
above, compare counts and the outstanding total with the live app, delete the drill database,
and add a line to the decisions log with the date and the time it took.

## Rotate keys

Secrets live only in Cloudflare (`wrangler secret`) and GitHub repository secrets; never in the
repository. Change one with `npx wrangler secret put <NAME>` (production) or
`npx wrangler versions secret put <NAME> --env preview` (preview), then redeploy.

| Secret                  | What it does                                             | Rotating it                                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY`        | Sends email                                              | Yearly (SPEC 11.1). Create a new key in Resend, put it, deploy, send a test, then revoke the old key.                                                                                                         |
| `RESEND_WEBHOOK_SECRET` | Verifies delivery and bounce webhooks                    | Roll the signing secret on the Resend webhook, then put the new value straight away (events signed with the old one are rejected until you do).                                                               |
| `BETTER_AUTH_SECRET`    | Signs sessions, client share links and file links        | **Only if it leaked.** Everyone is signed out and every client link (quotes and invoices) stops working; resend open documents so clients get new links. Use a long random value (`openssl rand -base64 48`). |
| `GOOGLE_CLIENT_*`       | Google sign-in (not switched on yet)                     | Make a new client secret in Google Cloud, put it, deploy, delete the old one.                                                                                                                                 |
| `CLOUDFLARE_API_TOKEN`  | GitHub Actions: deploys, previews, backups (GitHub only) | Create a new token (Workers, D1, R2 edit) in Cloudflare, update the GitHub secret, re-run a workflow, revoke the old token.                                                                                   |
| `E2E_SECRET`            | Test sign-in on previews only (never production)         | Change it in GitHub, preview (`--env preview`) and `.dev.vars` together.                                                                                                                                      |

After any rotation, run the smoke check: sign in, open a quote, download a PDF, send a test email
to yourself.

## Move the old app's records in (SPEC 12)

1. **Freeze.** The owner stops using the old app; note its last quote and invoice numbers.
2. **Export Firestore** on your computer. The service account key stays outside this folder.
   ```sh
   npm install --no-save firebase-admin@13
   GOOGLE_APPLICATION_CREDENTIALS=~/keys/insides-old-app.json \
     npx tsx scripts/migrate/export-firestore.ts --out migration-data --bucket <project>.appspot.com
   ```
3. **Export each browser** the old app was used on: open the old app, open the console, paste
   `scripts/migrate/browser-export.js`, and copy the downloaded file into `migration-data/`.
4. **Plan:** `npx tsx scripts/migrate/plan.ts migration-data/firestore.json migration-data/insides-browser-export-*.json`.
   Read the counts and every warning (duplicate numbers, tax rates other than 7.5%, records with no
   client) and settle them with the owner.
5. **Rehearse on preview:** `npx tsx scripts/migrate/import.ts migration-data/plan.json --remote --env preview`.
   Check the screens and the printed report.
6. **Import to production:** `npx tsx scripts/migrate/import.ts migration-data/plan.json --remote --yes`.
   It is safe to run again; anything already imported is skipped. Nothing is emailed.
7. **Reconcile:** the owner signs off `migration-data/client-balances.csv` (outstanding per client,
   old app vs now) and the counts in `import-report.json`. Totals that differ are listed; the old
   app summed floating-point numbers, so differences of a kobo or two are expected.
8. **Decommission:** keep Firebase read-only for 90 days, export a final archive, then delete it.
   `migration-data/` holds real client data: it is git-ignored; delete it when done.

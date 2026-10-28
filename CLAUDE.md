# Insides Interior — Quotes & Invoicing

Spec: docs/SPEC.md (source of truth; requirement IDs like FR-QT-07, DS-COL-03).

## Stack
React Router v7 (framework mode) on Cloudflare Workers, D1 + Drizzle, R2, Better Auth,
Resend + React Email, Tailwind 4 + shadcn/ui, Zod, Vitest, Playwright. TypeScript strict.

## Product rules
- Only app/features/*/service.ts writes to the database. Validate every input with Zod.
- Money is integer cents; quantities integer thousandths; rates basis points. Never floats.
- All calculation lives in app/domain (money, tax, numbering, lifecycle, diff). Pure, fully tested.
- The server recomputes every total. Never trust totals from the client.
- Multi-row writes use a D1 batch/transaction.
- Sent quotes/invoices are immutable; changes create a new revision. Unpaid invoices keep their
  number as "Revised (rev N)"; invoices with payments are voided and reissued.
- Portal routes (/q/:token, /i/:token) authenticate by hashed token only and allow exactly three
  writes: approve, post a message, raise a change request.
- Every state change, message and email event writes to activity via server/audit.ts.
- Secrets only via wrangler secret. Never commit .env or keys. Never log share tokens.
- The business is in Nigeria: naira (en-NG, kobo in `*_cents`), Africa/Lagos for business dates
  (store UTC), VAT 7.5% off by default. Country settings live in app/domain/locale.ts.

## Design rules (SPEC section 6)
- Tablet and phone first: test iPad landscape, iPad portrait, iPhone and desktop for every screen.
- Use tokens only (app/styles/tokens.css). No raw hex, px font sizes or ad-hoc spacing in components.
- Colour generously but meaningfully: module colours, status colours, avatars, charts (DS-COL).
- Touch targets 44px minimum, 48–52px for primary actions on touch. Labels always visible.
- Every screen has loading (skeleton), empty, error (Retry) and success states.
- Autosave status must be truthful. Disable buttons while saving.
- WCAG 2.2 AA in light and dark; never colour alone; respect reduced motion.
- Reuse components from app/components; add new ones to the /design route.

## Legacy code
- legacy/ holds the old app for reference only. Never import from it.
- Port or refactor from legacy/ only as SPEC section 2.5 allows; otherwise rewrite. Log non-obvious calls in docs/decisions.md.
- Use the words in SPEC section 0.2 everywhere (Client, not Customer; Catalogue item; Approve, not Accept).

## Commands
npm run dev | npm run check | npm run test:e2e | npm run db:generate | npm run db:migrate:local | npm run deploy
Run `npm run check` before finishing any task and list anything incomplete.

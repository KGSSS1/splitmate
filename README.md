# SplitMate

Share expenses with friends and groups, see exactly who owes whom, and settle up.

Built with Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui and Supabase. The product spec is [`docs/SPEC.md`](docs/SPEC.md); progress is tracked in [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).

## Prerequisites

- Node.js 24 (LTS; `package.json` pins `"engines": { "node": "24.x" }`, matching Vercel) and npm
- Docker Desktop (for the local Supabase stack; on Windows, WSL2 backend recommended)

## Setup

1. Install dependencies (this also downloads the Supabase CLI binary):

   ```bash
   npm install
   ```

2. Install the Playwright browser used by the E2E tests:

   ```bash
   npx playwright install chromium
   ```

3. Start the local Supabase stack (first run pulls Docker images and takes a few minutes):

   ```bash
   npm run db:start
   ```

4. Create `.env.local` from the example and fill in the local values:

   ```bash
   cp .env.example .env.local
   npx supabase status -o env
   ```

   Copy `API_URL` → `NEXT_PUBLIC_SUPABASE_URL`, `PUBLISHABLE_KEY` → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SECRET_KEY` → `SUPABASE_SECRET_KEY`. Never put the secret key in a `NEXT_PUBLIC_` variable; startup validation rejects it.

5. Apply migrations and seed data to a fresh local database:

   ```bash
   npm run db:reset
   ```

   The seed creates synthetic local users `alice`, `bob`, `carol` and `dave` `@example.test`, all with the local-only password `splitmate-local-dev`. See [docs/database.md](docs/database.md) for the schema, security model and RPC functions.

6. Regenerate database types after any migration:

   ```bash
   npm run db:types
   ```

7. Run the dev server at <http://localhost:3000>:

   ```bash
   npm run dev
   ```

Local services: Studio <http://127.0.0.1:54323>, Mailpit (auth emails) <http://127.0.0.1:54324>. Stop the stack with `npm run db:stop`.

## Trying the app locally

- Sign up at <http://localhost:3000/signup>. Email confirmation is on, so open Mailpit at <http://127.0.0.1:54324>, click the link in the "Confirm your SplitMate account" email, then pick your name and default currency.
- Or log in as a seed user (e.g. `alice@example.test` / `splitmate-local-dev`); the dashboard shows Alice's seeded balances.
- Password reset emails also land in Mailpit.
- **Recurring expenses:** on Add expense, set "Repeat" (or use Recurring → Add recurring expense). Anything due up to today is added when you save. Later dates are added by the hourly `pg_cron` job while the local stack runs; to add due ones right away, run `npm run db:recurring`.
- **Receipts:** open an expense and use "Add receipt" (JPEG, PNG, WebP or PDF, up to 5 MB).
- **Approximate total:** run `npm run db:rates` once (it fetches today's ECB rates from Frankfurter into the local database). Alice's dashboard then shows her INR and USD balances as one approximate INR figure.
- **Install as an app / offline:** the service worker registers in production builds only (`npm run build`, then `npm start`). Turn the network off in DevTools to see the offline banner and offline page.
- **Your data:** Settings → **Your data** downloads everything as JSON, or one table as CSV. Settings → **Delete account** works once your balances are zero (try it as `dave@example.test`).
- **Notifications, search, analytics:** log in as Alice and open Notifications (unread badge in the sidebar or the bell on phones), Search, or Analytics (filters, Chart/Table toggles, "Print or save as PDF", Expenses CSV and Repayments CSV). Turn notification types on or off in Settings → Notifications.
- After changing `supabase/config.toml` or `supabase/templates/`, restart the stack (`npm run db:stop` then `npm run db:start`).
- Email links go to `NEXT_PUBLIC_APP_URL`/auth/confirm. That URL must match `additional_redirect_urls` in `supabase/config.toml` (`http://localhost:3000/**` and the E2E port `http://localhost:3100/**` are allowed).

## Checks

| Check | Command |
| --- | --- |
| Lint | `npm run lint` |
| Type check | `npm run typecheck` |
| Unit and component tests (Vitest, jsdom) | `npm test` |
| Integration tests (Vitest against the local Supabase stack) | `npm run test:integration` |
| End-to-end tests (Playwright; starts its own dev server on port 3100, reads emails from Mailpit; needs the local stack) | `npm run test:e2e` |
| Database tests (pgTAP; needs the local stack) | `npm run db:test` |
| End-to-end tests against the staging deployment (needs `.env.e2e.local`, see docs/deployment.md) | `npm run test:e2e:staging` |
| Service worker in a production build (`npm run build`, then `npm start -- --port 3300`) | `E2E_PRODUCTION_URL=http://localhost:3300 npx playwright test tests/e2e/pwa-production.spec.ts` |
| Production build | `npm run build` then `npm start` |

`npm run dev`, `npm run build` and `npm run test:e2e` need a valid `.env.local`; a missing or wrong variable stops startup with a list of what to fix.

## Deployment

Staging (hosted Supabase + Vercel preview) and production are described step by step in [docs/deployment.md](docs/deployment.md).

## More documentation

- [SECURITY.md](SECURITY.md): threat model, how access is enforced, known limits, how to report a vulnerability.
- [docs/api.md](docs/api.md): every database function, route handler and Server Action, and what each checks.
- [docs/database.md](docs/database.md): schema, RLS, functions, jobs, tests.
- [docs/architecture.md](docs/architecture.md): the accounting engine and each feature's design.
- [docs/reviews/](docs/reviews/): independent review findings and their fixes.

## Project layout

```
src/app/         routes (App Router)
src/components/  UI components (shadcn/ui in components/ui)
src/config/      brand config
src/lib/         env validation, Supabase clients and pure domain logic
src/server/      Server Actions and data access (identity checks live here)
src/proxy.ts     session refresh and route protection
src/types/       generated Supabase types
supabase/        CLI config, auth email templates, migrations, seed, pgTAP tests
tests/           unit, integration and e2e tests
docs/            spec and technical docs
```

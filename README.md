# SplitMate

Share expenses with friends and groups, see exactly who owes whom, and settle up.

Built with Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui and Supabase. The product spec is [`docs/SPEC.md`](docs/SPEC.md); progress is tracked in [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).

## Prerequisites

- Node.js 22 or newer (developed on Node 24 LTS) and npm
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

## Checks

| Check | Command |
| --- | --- |
| Lint | `npm run lint` |
| Type check | `npm run typecheck` |
| Unit / integration tests (Vitest) | `npm test` |
| End-to-end tests (Playwright; starts its own dev server on port 3100) | `npm run test:e2e` |
| Database tests (pgTAP; needs the local stack) | `npm run db:test` |
| Production build | `npm run build` then `npm start` |

`npm run dev`, `npm run build` and `npm run test:e2e` need a valid `.env.local`; a missing or wrong variable stops startup with a list of what to fix.

## Project layout

```
src/app/         routes (App Router)
src/components/  UI components (shadcn/ui in components/ui)
src/config/      brand config
src/lib/         env validation and pure domain logic
src/types/       generated Supabase types
supabase/        CLI config, migrations, seed, pgTAP tests
tests/           unit, integration and e2e tests
docs/            spec and technical docs
```

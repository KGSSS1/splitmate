@AGENTS.md

# SplitMate

SplitMate is an original expense-sharing web app (inspired by Splitwise's core features): friends and groups, multi-payer expenses with equal/exact/percentage/share/itemized splits, a pairwise ledger for balances, settlements with confirmation, debt simplification, recurring expenses, receipts, analytics, notifications, and a PWA. Next.js App Router + Supabase (Postgres, Auth, Storage), free tiers only.

**`docs/SPEC.md` is the single source of truth for scope.** Progress and handoff notes live in `IMPLEMENTATION_PLAN.md`.

## Session routine

- Start: read this file, `IMPLEMENTATION_PLAN.md` (handoff note at the top) and the relevant `docs/SPEC.md` sections; run the test suite before changing anything.
- One milestone (SPEC §21) per session unless told otherwise. Keep going until its definition of done is met.
- End of milestone: lint, typecheck, tests, db tests, build all pass → update `IMPLEMENTATION_PLAN.md` (tick boxes, handoff note at the top) → commit → SPEC §22 report.
- Update `IMPLEMENTATION_PLAN.md` and commit after each milestone.

## Commands

| Task | Command |
| --- | --- |
| Dev server | `npm run dev` |
| Lint | `npm run lint` |
| Type check | `npm run typecheck` (runs `next typegen` then `tsc --noEmit`) |
| Unit/integration tests (Vitest) | `npm test` (watch: `npm run test:watch`) |
| E2E tests (Playwright) | `npm run test:e2e` |
| Database tests (pgTAP) | `npm run db:test` |
| Build | `npm run build` |
| Start local Supabase | `npm run db:start` (stop: `npm run db:stop`) |
| Reset local DB (migrations + seed) | `npm run db:reset` |
| Generate DB types | `npm run db:types` → `src/types/database.types.ts` |

Local Supabase needs Docker. `.env.local` values come from `npx supabase status`.

## Stack and version-sensitive conventions

- Next.js 16 App Router, React 19, TypeScript `strict` + `noUncheckedIndexedAccess`, Tailwind v4, shadcn/ui (base-nova, Base UI primitives), Lucide icons, Zod, React Hook Form, Recharts, Supabase via `@supabase/ssr` + `@supabase/supabase-js`.
- Next 16: request interception is `src/proxy.ts` exporting `proxy` (not `middleware.ts`). `cacheComponents` is enabled. Check `node_modules/next/dist/docs/` before using an unfamiliar API.
- Supabase keys: `sb_publishable_...` in client code, `sb_secret_...` only in server-only code. No legacy `anon`/`service_role` JWT keys.
- Server identity: `getUser()` / `getClaims()`, never `getSession()` alone on the server.
- Verify library APIs against installed types/docs, not memory.

## Code conventions

- `src/` layout; import via `@/…`. Files and folders `kebab-case`; React components `PascalCase`; functions/variables `camelCase`; constants `SCREAMING_SNAKE_CASE`; DB tables/columns `snake_case`.
- Server Actions and data access in `src/server/`; pure logic in `src/lib/<domain>/`; Zod schemas shared by forms and actions in `src/lib/validation/`.
- No `any` without a justifying comment. No unhandled promise rejections. No placeholder modules — create files when they are implemented.
- No mock data, hardcoded balances, or fake success messages in place of real features.
- Env vars only through `src/lib/env.ts` (`getClientEnv()`, `getServerEnv()`); validated at startup from `next.config.ts`.
- Branding (name, logo, colors) only in `src/config/brand.ts`; CSS tokens in `src/app/globals.css` mirror its colors.
- Users never see stack traces or SQL errors.

## Money rules (SPEC §7)

- Amounts are integer **minor units** per ISO 4217 exponent (INR/USD 2, JPY 0, KWD 3) — never assume 2 decimals.
- Postgres `bigint`; TypeScript `number` checked with `Number.isSafeInteger` at every boundary (no JS `bigint`: not serializable).
- Never floating-point math on money; parse `"123.45"` straight to minor units, no `parseFloat`.
- Percentages are integer basis points (10000 = 100%); weights are positive integers.
- Rounding: largest remainder method, ties by entry order then user ID. Shares always sum exactly to the total.
- Sign: positive = others owe this person; negative = this person owes.
- Balances never mix currencies. Display with `Intl.NumberFormat` (default locale `en-IN`).
- Split math lives only in `src/lib/accounting` (TypeScript). SQL functions validate invariants; they never re-implement splitting.
- Debt simplification output is "simplified", never "optimal".

## Database and migrations (SPEC §6)

- Every schema change is a migration in `supabase/migrations/`; test from scratch with `npm run db:reset`; then `npm run db:types`.
- UUID PKs, FKs, `NOT NULL`, `CHECK`s, indexes on FKs and filter columns, `created_at`/`updated_at`. Dates of expenses are `date`; event times `timestamptz`.
- `ledger_entries` are pairwise and append-only; edits write reversing + new entries. Balances come from the ledger, never stored totals.
- Multi-row financial writes go through PL/pgSQL functions called with `supabase.rpc()`: check `auth.uid()` and membership, lock rows (`FOR UPDATE`), check `version`, validate invariants, one transaction.
- `SECURITY DEFINER` only when needed, always with `SET search_path = ''` and explicit auth checks.
- Never `ON DELETE CASCADE` from profiles into financial tables.
- `seed.sql` is synthetic local data only.

## Auth and authorization (SPEC §8)

- RLS on every exposed table, default deny. Avoid recursive policies — use `SECURITY DEFINER` helpers like `is_group_member()`.
- Server Actions and route handlers re-verify identity and authorization and validate input with Zod. Never rely on hidden UI.
- `ledger_entries` and `audit_events`: insert only via DB functions; no client `UPDATE`/`DELETE`.
- The admin (secret-key) client is imported only from files with `import "server-only"`.

## Rules

- Every new feature needs tests; every bug fix needs a regression test. Accounting changes need unit tests and database tests.
- Never hardcode credentials; the secret key is server-only. Check for secrets before every commit.
- Ask before touching remote systems: `supabase link`, `supabase db push`, `supabase db reset --linked`, hosted settings, Vercel production deploys. Local `supabase db reset` is fine.
- If a SPEC §2 decision proves impractical, stop and propose an alternative instead of silently changing behavior.

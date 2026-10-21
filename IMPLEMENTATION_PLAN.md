# SplitMate — Implementation Plan

## Handoff note (latest first)

### 2026-10-21 — M0 Foundation complete

- **Done:** Next.js 16.4 (App Router, `src/`, TS strict + `noUncheckedIndexedAccess`), Tailwind v4, shadcn/ui (base-nova, `Button`), ESLint (no-explicit-any = error), Vitest + RTL (jsdom), Playwright (desktop + Pixel 7 Chromium), Supabase CLI 2.121 as a dev dependency with `supabase init` and a running local stack, pgTAP smoke test, generated (empty) DB types. `CLAUDE.md`, `.env.example`, `src/lib/env.ts` (Zod, validated from `next.config.ts`), `src/config/brand.ts` + original logo, README.
- **Next:** M1 — money and accounting engine (`src/lib/money`, `src/lib/accounting`, `src/lib/settlements`), pure TypeScript, no UI. Add `fast-check` for property tests.
- **Known issues:**
  - `npm audit` reports 5 high-severity advisories in dev-only lint tooling (`micromatch`/`fast-glob` via `eslint-config-next`); no non-breaking fix yet. Not shipped to the browser.
  - `@vitejs/plugin-react` was left out (its optional peer chain conflicts with Babel 8); Vitest handles JSX natively, which is enough for tests.
  - Dark theme tokens exist (`.dark`) but nothing toggles them yet (M3).
  - Playwright runs its own dev server on port 3100 (`E2E_PORT` overrides) because another local app was already on :3000. When auth lands (M3), make redirect URLs follow the E2E port.
  - `next dev` re-writes the managed block in `AGENTS.md`; it is committed intentionally and imported by `CLAUDE.md`.

---

## Milestones

### M0 — Foundation ✅
- [x] Next.js + TypeScript strict + Tailwind + shadcn/ui + ESLint
- [x] Vitest + React Testing Library + Playwright, one passing test each
- [x] Supabase CLI (dev dependency), `supabase init`, local stack runs
- [x] `CLAUDE.md`, `IMPLEMENTATION_PLAN.md`, `.env.example`, `src/lib/env.ts`, `src/config/brand.ts`, README
- [x] npm scripts: dev, build, lint, typecheck, test, test:e2e, db:start, db:reset, db:test, db:types
- [x] Lint, typecheck, unit, e2e, db tests and build pass

### M1 — Money and accounting engine (no UI)
- [ ] `lib/money`: currency table with ISO 4217 exponents, string → minor-unit parsing, formatting (`en-IN` default), safe-integer guards
- [ ] `lib/accounting`: equal, exact, percentage (basis points), weighted-share splits
- [ ] Largest remainder rounding with stable tie-breaks
- [ ] Itemized bills with tax, service charge, tip, discounts (proportional, equal override)
- [ ] Multi-payer expenses and pairwise allocation of shares to payers
- [ ] Per-user, per-pair, per-group balances; currency separation
- [ ] Settlements (partial/full), amendments and reversals
- [ ] `lib/settlements`: deterministic greedy debt simplification
- [ ] All SPEC §7 / §17 unit tests incl. ₹900 and ₹100÷3 cases, multi-payer pairwise test, `fast-check` property tests
- [ ] Document the itemized rounding rule in `docs/architecture.md`

### M2 — Database schema, RLS, and transactional functions
- [ ] Migrations for all SPEC §6 tables, constraints, indexes, timestamps
- [ ] `auth.users` → `profiles` trigger; public profile view/function
- [ ] Helper functions (`is_group_member`, etc.) and RLS on every table
- [ ] Pairwise append-only `ledger_entries`; balance views/functions
- [ ] RPCs: create/edit/cancel expense, create/confirm/reject/cancel settlement, accept invitation
- [ ] Invitation tokens (hashed, expiring, revocable, max uses); Postgres-backed rate limits
- [ ] Private `receipts` bucket + storage policies
- [ ] `seed.sql` with synthetic users; generated types
- [ ] pgTAP tests: constraints, RLS (member / non-member / removed / anon), RPCs, stale version, idempotency, token misuse, storage
- [ ] `docs/database.md`

### M3 — Auth and app shell
- [ ] Sign-up, email verification (local Mailpit), login, password reset, logout
- [ ] `src/proxy.ts` session refresh; protected routes; Supabase server/browser/admin clients
- [ ] Onboarding (name, default currency); profile settings
- [ ] Responsive shell: mobile bottom nav + Add Expense, desktop sidebar, safe-area insets
- [ ] Light/dark themes, loading skeletons, error/not-found pages
- [ ] Empty dashboard reachable on mobile and desktop
- [ ] First staging deployment (hosted Supabase + Vercel preview) — **needs approval**

### M4 — Friends, groups, invitations
- [ ] Friend requests by email; auto-friend on group join
- [ ] Group CRUD, member management, admin roles
- [ ] Invite links and email invitations; acceptance page `invite/[token]`
- [ ] Leave/remove only at zero balance in every currency
- [ ] E2E steps 1–2 pass

### M5 — Expenses
- [ ] Add/edit/duplicate/cancel expense (group and direct)
- [ ] All split types, multi-payer, itemized with tax/tip/discount
- [ ] Live share preview with rounding indicator; server-side recomputation
- [ ] Expense detail, version history (before/after), comments
- [ ] E2E step 3 passes; edit/cancel reflected in balances

### M6 — Balances, dashboard, settlements
- [ ] Group and friend balances (per currency)
- [ ] Dashboard: owe / owed / net, by person, groups, recent activity and settlements, quick actions
- [ ] Simplify-debts toggle and suggested transfers
- [ ] Settle-up flow with pending/completed/rejected/cancelled states; settle-up-everything
- [ ] Settlement history
- [ ] E2E steps 4–9 pass; staging deploy of the MVP — **needs approval**

### M7 — Recurring expenses and receipts
- [ ] Recurring templates (frequency, dates, timezone, resolved shares); pause/resume/cancel
- [ ] Month-end handling; idempotent `recurring_occurrences`
- [ ] `pg_cron` generator + npm script to run it manually
- [ ] Receipt upload (type sniffing, 5 MB, client compression), signed URLs
- [ ] Generator twice → each occurrence once; non-members denied receipts

### M8 — Notifications, search, analytics, exports
- [ ] In-app notifications created inside DB functions; unread count, mark read, preferences
- [ ] Search
- [ ] Analytics (paid / your share / owed / settlements) with charts and table views
- [ ] Server-side CSV export; print stylesheet
- [ ] Tests for each; charts match database totals

### M9 — Multi-currency conversion, PWA, privacy, hardening, deployment
- [ ] Optional conversion with stored `exchange_rates` (Frankfurter)
- [ ] Manifest, icons (maskable), minimal service worker, offline banner
- [ ] Data export and account deletion (anonymization)
- [ ] Security review vs SPEC §8; `supabase db lint` / advisors clean; `SECURITY.md`
- [ ] Accessibility pass (Lighthouse ≥ 90 on key mobile pages)
- [ ] `docs/deployment.md`; production deploy and smoke test — **needs approval**
- [ ] Full E2E suite passes against staging

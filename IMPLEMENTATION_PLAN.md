# SplitMate — Implementation Plan

## Handoff note (latest first)

### 2026-10-21: Staging on Vercel Git integration (phone test pending)

- **Setup:**
  - GitHub repo `KGSSS1/splitmate` (public) is connected to the Vercel project `splitmate` (scope `kgsss1s-projects`).
  - `main` deploys to Production; `staging` deploys as a Preview at `https://splitmate-git-staging-kgsss1s-projects.vercel.app`. Other branches get their own branch URLs.
  - The guide is `docs/deployment.md`.
- **App URL (`resolveAppUrl`, `src/lib/env.ts`):**
  - Previews derive `NEXT_PUBLIC_APP_URL` from `VERCEL_BRANCH_URL`, falling back to `VERCEL_URL`. Don't set it in Preview.
  - Production must set it explicitly; the build fails with a Vercel-specific message otherwise.
- **State as of this note:**
  - The `staging` preview builds (Ready).
  - Both `main` builds failed with "NEXT_PUBLIC_APP_URL is missing". This is expected until production exists; don't push to `main` before then.
  - Vercel Authentication is still **on**, and the Function Region is `iad1`.
  - The Supabase staging project, migration push, auth settings and phone test are not done yet. This session has no confirmation of any of them.
- **Fixed:** `.vercelignore` patterns are anchored to the root (`/supabase/` had been dropping `src/lib/supabase/`); `tests/unit/vercelignore.test.ts` guards this. Node is pinned to `24.x`.
- **Code:**
  - `SUPABASE_SECRET_KEY` is optional until M9.
  - Migration `20261021131000_service_role_grants.sql` plus pgTAP `100_service_role_grants`: hosted projects no longer add default Data API grants (Supabase changelog 45329).
- **Rule for later migrations:** every new table needs explicit `GRANT`s for `authenticated` (as needed) **and** `service_role`.
### 2026-10-21 — M3 Auth and app shell complete (staging deployment not done)

- **Done:**
  - **Auth** with `@supabase/ssr` 0.12: sign-up, email verification, login, logout, password reset and resend-confirmation.
    - Email links use the token-hash flow (`supabase/templates/` → `/auth/confirm`).
    - `src/proxy.ts` refreshes the session and redirects by route access.
    - Server identity comes from `getClaims()` through `src/server/auth.ts`.
  - **Local auth config:** email confirmation is on (Mailpit), minimum password length is 8, and `secure_password_change` is on. Redirect URLs allow ports 3000 and 3100.
  - **Pages:**
    - Onboarding (name, default currency, time zone detected from the browser).
    - Settings: profile, theme, change password, log out.
  - **Dashboard:** real owed / owing / net totals per currency from `friend_balances()` (`src/lib/accounting/summary.ts`), and an empty state when there are none.
  - **Shell:** desktop sidebar; phone header menu and bottom bar with an Add Expense button; safe-area insets; skip link.
  - **Themes:** light / dark / system.
  - **States:** loading skeletons, empty states, error, global-error and not-found pages.
  - Architecture notes: `docs/architecture.md` (end).
- **Tests:**
  - 253 unit/component tests: routes, proxy, auth errors, schemas, balance summary, theme, sign-up form.
  - The first Vitest integration suite against local Supabase (8 tests, `npm run test:integration`).
  - 10 Playwright runs (5 tests × desktop + Pixel 7): sign up → Mailpit link → onboarding → log out → log in → empty dashboard; password reset by email; invalid link; landing; protected redirect.
  - pgTAP unchanged (274).
- **Decisions to know:**
  - **Nav items for pages not built yet** (Groups, Friends, Activity, Add Expense) are shown disabled with "Soon". They come from `src/components/layout/nav-config.ts`; set `available: true` in M4/M5/M6.
  - **No browser or secret-key Supabase client yet.** The no-placeholder rule applies; add each when first needed (realtime in M8, account deletion in M9). Integration tests make their own secret-key client in `tests/integration/support/`.
  - **`npm test` now runs only the `unit` Vitest project.** Integration tests need the local stack.
  - **Next dev badge moved to bottom-right** (`next.config.ts`): bottom-left covered the sidebar's Log out button and blocked clicks.
  - **Theme lives in `localStorage`** (per device), not in the profile.
- **Next:**
  - First staging deployment (hosted Supabase + Vercel preview). **Needs approval**, plus a hosted project, a Vercel account and SMTP settings from you.
  - Then M4: friends, groups, invitations.
- **Known issues:**
  - The theme picker shows "System" until hydration when another theme is saved. The page colours are right from the first paint.
  - Email link scanners that pre-fetch links could use up a confirmation token. Requests for a new link are handled (resend button on login).

### 2026-10-21 — M2 security review fixes

- An independent security review of the M2 migrations found 10 issues: 3 high, 1 medium, 6 low.
  - **High: rerouted debts.** A member calling `create_expense` directly could route debts through uninvolved people. Pairwise rows are now checked to be proportional to the payments.
  - **High: rejoining through an old invitation.** A removed member could rejoin with an invitation they had created earlier. Leaving or removal now revokes the member's invitations, and an invitation needs its creator to still be a member.
  - **High: balances for former members.** Editing or cancelling an old expense could give a former member a balance. History involving a former member is now frozen.
  - **Low:**
    - Removed members could still edit comments and act on pending settlements.
    - The invitation rate limit could be raced.
    - Default privileges didn't revoke the built-in PUBLIC execute grant.
    - Removed members still got group notifications.
    - `profile_cards` showed later joiners.
    - Input checks were loose: unknown currencies, unlimited tag length, implausible dates.
  - **Also fixed** from the plausible and hardening list:
    - Email invitations need a confirmed email.
    - Deleted accounts can't write.
    - Payload size caps.
    - Arbitrary-ID helpers are no longer executable by clients.
    - Test helpers pin `search_path`.
- The fixes were made in the original M2 migrations, which have never been applied outside the local database. `090_security_review.test.sql` has 31 regression tests, and `tests/unit/money/currency-sync.test.ts` keeps the SQL and TypeScript currency lists in sync. `supabase db lint` and `supabase db advisors` (warn level) are clean.
- **Behaviour to know for M5/M6:** expenses involving a former member can't be edited or cancelled (SM409). Leaving cancels the leaver's pending group settlements.
- **Still open (decisions, not bugs):**
  - Local `enable_confirmations = false` in `supabase/config.toml`. M3 should turn on email confirmation (Mailpit locally) per SPEC §8.
  - Friendships made by joining a group are never removed, so a removed member can still create direct expenses with former group-mates. SPEC §2 allows this.

### 2026-10-21 — M2 Database schema, RLS and transactional functions complete

- **Done:** 10 migrations in `supabase/migrations/`:
  - 19 tables (all of SPEC §6 except `exchange_rates`), with domains for amounts and currencies, constraints, FK indexes and `updated_at` triggers.
  - The `auth.users` → `profiles` signup trigger and email sync.
  - Append-only triggers on `ledger_entries` and `audit_events`.
  - RLS on every table via `SECURITY DEFINER` helpers in a non-exposed `private` schema; Supabase's default grants revoked; column-level grants for the few direct writes.
  - 13 RPCs (groups, invitations, membership, expenses, settlements) plus `group_balances`, `friend_balances` and `profile_cards`.
  - Private `receipts` bucket and its policies.

  Also: `seed.sql` (4 synthetic users, data created through the RPCs), regenerated types, `docs/database.md`, and 240 pgTAP tests in 8 files (243 counting the helper-install and M0 smoke files). `supabase db lint` is clean.
- **Next:** M3 — auth and app shell: `@supabase/ssr` clients (server/browser/admin), `src/proxy.ts` session refresh, signup/verify/login/reset/logout, onboarding, profile settings, responsive shell and themes. Then the first staging deployment, **with approval**.
- **Notes for later milestones:**
  - Map RPC errors by SQLSTATE (`SM401/403/404/409/422/429`); messages are user-safe. Constraint errors (`23xxx`) should become a generic message.
  - Server Actions must run `src/lib/accounting` and pass the resulting `shares` / `ledger_entries` payloads in snake_case (see the payload comment at the top of `20261021130700_rpc_expenses.sql`).
  - `recurring_expenses` / `recurring_occurrences` only have tables and read RLS; their RPCs and the `pg_cron` generator come in M7. Friend requests by email are M4.
  - SPEC §17 also mentions Vitest integration tests against local Supabase; none exist yet. M3 should add a first one once the Supabase clients exist.
- **Known issues:** none new. The `npm audit` lint-tooling advisories from M0 remain.

### 2026-10-21 — M1 Money and accounting engine complete

- **Done:** Pure TypeScript engine, no UI or DB. `src/lib/money` (ISO 4217 table, safe-integer guards, float-free `parseMoney`, `formatMoney` with en-IN default). `src/lib/accounting` (largest-remainder `roundShares`, equal/exact/percentage/shares splits, itemized with tax/service/tip/discount rounded once, multi-payer pairwise allocation with whole-matrix rounding, append-only ledger entries with reversals for edit/cancel, settlement entries only when completed, per-user/group/pair balances per currency, idempotency keys). `src/lib/settlements` (greedy `simplifyDebts`, settlement lifecycle state machine). Rules documented in `docs/architecture.md`. 173 unit tests incl. fast-check properties. tsconfig target bumped to ES2022 (BigInt literals).
- **Next:** M2 — migrations, RLS, RPC functions that *validate* this engine's output (payers/shares sums, pairwise entries reconcile with shares), seed data, pgTAP tests. Ledger entry shape and settlement transitions to mirror are in `docs/architecture.md`.
- **Decisions to keep in mind for M2:**
  - Ledger amounts are always positive; a reversal swaps debtor/creditor and has `entry_type = 'reversal'`, linked to the version it reverses. Settlement entries use version 1.
  - A payer may withdraw (cancel) their own *pending* settlement; the receiver rejects instead. SPEC doesn't say; confirmed by the user on 2026-10-21. M2's settlement RPC must allow it.
  - Max amount = `Number.MAX_SAFE_INTEGER` minor units; add a matching `CHECK (amount <= 9007199254740991)` in M2.
  - After the independent review (2026-10-21): `buildExpenseEntries` takes the expense `total`; `amendExpenseEntries(current, next)` and `cancelExpenseEntries(current)` take the stored *version input* (payers + shares) and rebuild its charges to reverse. M2's edit/cancel RPCs should likewise check that the reversals match the stored ledger rows of the current version exactly.
- **Known issues:** `npm run db:test` was not re-run at the end of M1 because Docker Desktop was not running (M1 changed no SQL). Earlier M0 notes below still apply.

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

### M1 — Money and accounting engine (no UI) ✅
- [x] `lib/money`: currency table with ISO 4217 exponents, string → minor-unit parsing, formatting (`en-IN` default), safe-integer guards
- [x] `lib/accounting`: equal, exact, percentage (basis points), weighted-share splits
- [x] Largest remainder rounding with stable tie-breaks
- [x] Itemized bills with tax, service charge, tip, discounts (proportional, equal override)
- [x] Multi-payer expenses and pairwise allocation of shares to payers
- [x] Per-user, per-pair, per-group balances; currency separation
- [x] Settlements (partial/full), amendments and reversals; settlement lifecycle state machine
- [x] `lib/settlements`: deterministic greedy debt simplification
- [x] All SPEC §7 / §17 unit tests incl. ₹900 and ₹100÷3 cases, multi-payer pairwise test, `fast-check` property tests
- [x] Document the rounding rules in `docs/architecture.md`

### M2 — Database schema, RLS, and transactional functions ✅
- [x] Migrations for all SPEC §6 tables, constraints, indexes, timestamps (`exchange_rates` deferred to M9)
- [x] `auth.users` → `profiles` trigger; public profile function (`profile_cards`)
- [x] Helper functions (`is_group_member`, etc.) and RLS on every table
- [x] Pairwise append-only `ledger_entries`; balance functions
- [x] RPCs: create/edit/cancel expense, create/confirm/reject/cancel settlement, create/accept/revoke invitation, create group, leave/remove member
- [x] Invitation tokens (hashed, expiring, revocable, max uses); Postgres-backed rate limits
- [x] Private `receipts` bucket + storage policies
- [x] `seed.sql` with synthetic users; generated types
- [x] pgTAP tests: constraints, RLS (member / non-member / removed / anon), RPCs, stale version, idempotency, token misuse, storage
- [x] `docs/database.md`

### M3 — Auth and app shell (staging deployment pending)
- [x] Sign-up, email verification (local Mailpit), login, password reset, logout
- [x] `src/proxy.ts` session refresh; protected routes; Supabase server client (browser/admin clients deferred until first use)
- [x] Onboarding (name, default currency); profile settings
- [x] Responsive shell: mobile bottom nav + Add Expense, desktop sidebar, safe-area insets
- [x] Light/dark themes, loading skeletons, error/not-found pages
- [x] Empty dashboard reachable on mobile and desktop
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

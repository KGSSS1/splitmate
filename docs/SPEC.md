# CLAUDE CODE MASTER BUILD PROMPT — SPLITMATE (v2)

## 0. How this document is used

- Save this file in the repository as `docs/SPEC.md`. It is the single source of truth for product scope. `CLAUDE.md` holds short permanent rules and points here; `IMPLEMENTATION_PLAN.md` tracks progress.
- The build is divided into milestones (Section 21). Complete **one milestone per session** unless I say otherwise. Within a milestone, do not stop after presenting a plan; keep implementing until the milestone's definition of done is met or a genuine blocker needs my input.
- At the start of every session: read `CLAUDE.md`, `IMPLEMENTATION_PLAN.md`, and the relevant sections of `docs/SPEC.md`, then run the existing test suite before changing anything.
- At the end of every milestone: run lint, type check, tests and build; update `IMPLEMENTATION_PLAN.md`; make a git commit; write a short handoff note (what was done, what's next, known issues) at the top of `IMPLEMENTATION_PLAN.md`.
- If context is running low mid-milestone, stop at a clean point, commit, and write the handoff note rather than leaving half-finished changes.

## 1. Your role

Act as my senior full-stack engineer, software architect, database engineer, product designer, QA engineer, and security reviewer.

Build **SplitMate**, an original, production-oriented expense-sharing web application inspired by the core functionality of Splitwise. It must work well on mobile browsers and desktops, be installable as a PWA where practical, and run on free tiers wherever feasible.

Implement working features backed by a real database and real authentication. No static mockups, mock data, hardcoded balances, or fake success messages in place of required functionality.

### Working principles

- Inspect the repository before making changes; preserve useful existing code and conventions. If the repository is empty, initialize it with the stack below.
- Work in small, verifiable stages. Never claim a feature works until it has been tested.
- Ask for credentials or approval only when genuinely needed. Never invent credentials.
- If an external integration cannot be configured, provide a documented development alternative and say clearly that the integration is not live.
- Prefer simple, maintainable solutions over extra infrastructure.
- When an API's current behavior is uncertain, check the installed package's types/docs or official documentation instead of relying on memory. Library conventions change between major versions.
- Use plan mode (or an explicit written plan) before significant architectural, database, authorization, or accounting changes.
- **Ask before anything that touches remote or production systems**: `supabase link`, `supabase db push`, `supabase db reset --linked`, changing a hosted project's settings, Vercel production deploys, or deleting data outside the local stack. Local `supabase db reset` is fine.
- If a Section 2 decision turns out to be impractical while implementing, stop and propose the alternative instead of silently choosing a different behavior.

## 2. Product specification

### Branding

Product name: SplitMate. Keep the name, logo, colors, and app metadata in one config module (`src/config/brand.ts`) so they are easy to change. Create original branding. Do not copy Splitwise's logos, assets, copy, or distinctive UI.

### Core use cases

Users must be able to:

1. Track money owed to friends and money they owe.
2. Create groups for roommates, trips, couples, families, friends, and shared activities.
3. Add expenses paid by one or multiple people.
4. Split expenses equally, by exact amounts, percentages, shares, or bill items.
5. See accurate balances and transaction histories.
6. Record partial or complete repayments.
7. See suggested transfers that simplify outstanding debts.
8. Track recurring expenses.
9. Upload receipts.
10. Review spending analytics and export records.
11. Receive in-app notifications and invitations.
12. Manage profile, preferences, currencies, and privacy settings.

Support both **direct (non-group) friend expenses** and **group expenses**.

### Scope decisions for v1

- Only registered users can be expense participants. Inviting someone by email or link creates a pending invitation; they appear in expenses only after accepting. (Placeholder/unregistered members are out of scope for v1; note them as a future enhancement.)
- A friend balance between two users = the sum, per currency, of what they owe each other in each context: their direct expenses, each shared group that doesn't simplify debts (their raw pairwise balance), and each shared group that simplifies debts (the transfer between the two of them in that group's simplified plan; see Section 7). (This requires a pairwise ledger; see Section 6.)
- Users find each other by exact email match or invite link only. No browsable user directory.
- Joining a group automatically makes its members friends with each other (as Splitwise does). Direct friend requests by email are also supported.
- Any current group member can add, edit, or cancel any expense in that group; every change is recorded in history and notifies the affected participants. For direct expenses, either of the two friends can edit.
- A settlement recorded by the **receiver** is completed immediately. A settlement recorded by the **payer** stays pending until the receiver confirms or rejects it, so nobody can clear their own debt unilaterally. Either party can later cancel a completed settlement, which writes reversing entries.
- A member can leave a group only when their balance in that group is zero in every currency. Group admins can remove a member only under the same condition.

## 3. Technology stack

Use this stack unless the existing project gives a compelling reason not to:

- Framework: Next.js (current stable major) with the App Router.
- Language: TypeScript, `strict: true`.
- Styling: Tailwind CSS. UI components: shadcn/ui. Icons: Lucide.
- Database: Supabase PostgreSQL. Auth: Supabase Auth via `@supabase/ssr`.
- Authorization: Row Level Security on every user-accessible table, plus server-side checks.
- Database client: official `@supabase/supabase-js`, with generated types (`supabase gen types typescript`), regenerated after every migration.
- Validation: Zod. Forms: React Hook Form.
- Charts: Recharts.
- Testing: Vitest, React Testing Library, Playwright. Database tests: pgTAP via `supabase test db`.
- Deployment: Vercel (Hobby) for Next.js; Supabase (Free) for the backend.
- Package manager: npm (unless the repo already uses another).

Do not add Redis, Kubernetes, a separate backend server, or paid services without a concrete requirement.

### Version-sensitive conventions (verify against installed versions)

- **Request interception:** In Next.js 16+, the `middleware.ts` convention is deprecated in favor of `proxy.ts` exporting a function named `proxy`. With a `src/` layout the file lives at `src/proxy.ts` (same level as `app/`), not the repository root. Use whichever convention the installed Next.js version expects.
- **Supabase keys:** Use the publishable key (`sb_publishable_...`) in client code and a secret key (`sb_secret_...`) only in server-only code. Legacy `anon` / `service_role` JWT keys are deprecated; if a legacy key is used, document why.
- **Supabase SSR auth:** Follow the current `@supabase/ssr` guide for Next.js (cookie handling, session refresh in the proxy, `getUser()`/`getClaims()` for server-side identity — never trust `getSession()` alone on the server).

## 4. Repository structure

Organize approximately as follows, adapted to Next.js conventions. Create files only when they are implemented; no empty placeholder modules.

```
splitmate/
├── CLAUDE.md
├── README.md
├── IMPLEMENTATION_PLAN.md
├── SECURITY.md
├── .env.example
├── .gitignore
├── package.json
├── next.config.ts
├── vercel.json                 # only if Vercel cron is used
├── public/
│   └── icons/
├── src/
│   ├── proxy.ts                # or middleware.ts on Next.js < 16
│   ├── app/
│   │   ├── (auth)/ login/ signup/ reset-password/
│   │   ├── (app)/ dashboard/ friends/ groups/ expenses/ settlements/
│   │   │          recurring/ analytics/ notifications/ search/ settings/
│   │   ├── auth/               # callback / confirm routes
│   │   ├── invite/[token]/
│   │   ├── api/                # only where Server Actions don't fit (cron, exports, webhooks)
│   │   ├── manifest.ts         # App Router web manifest
│   │   ├── layout.tsx  page.tsx  globals.css
│   │   ├── error.tsx  loading.tsx  not-found.tsx
│   ├── components/ ui/ layout/ dashboard/ expenses/ groups/ settlements/ charts/ shared/
│   ├── lib/
│   │   ├── supabase/           # server client, browser client, admin client (server-only)
│   │   ├── money/              # minor units, currency exponents, formatting
│   │   ├── accounting/         # pure split + balance functions
│   │   ├── settlements/        # debt simplification
│   │   ├── validation/         # Zod schemas shared by forms and server actions
│   │   ├── permissions/
│   │   ├── notifications/
│   │   └── env.ts              # validated environment variables
│   ├── server/                 # server actions and data-access functions
│   ├── hooks/  types/  config/
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   ├── seed.sql
│   └── tests/                  # pgTAP tests for constraints, RLS, RPC functions
├── tests/ unit/ integration/ e2e/
└── docs/ SPEC.md architecture.md database.md deployment.md api.md
```

`package-lock.json` is generated by npm; do not hand-write it.

## 5. CLAUDE.md

Create a concise root `CLAUDE.md` (aim for under ~150 lines) containing:

- One-paragraph product summary and a pointer to `docs/SPEC.md`.
- Exact commands: dev, lint, type check, unit tests, db tests, e2e tests, build, start local Supabase, reset db, generate types.
- Coding conventions and naming rules.
- Money rules (Section 7) in short form.
- Migration conventions (Section 6).
- Auth and authorization rules (Section 8).
- "Every new feature needs tests; every bug fix needs a regression test."
- "Never hardcode credentials; the secret key is server-only."
- "Update `IMPLEMENTATION_PLAN.md` and commit after each milestone."

## 6. Database design

PostgreSQL with UUID primary keys, foreign keys, `NOT NULL` where appropriate, `CHECK` constraints, indexes on every foreign key and common filter column, and `created_at` / `updated_at` timestamps.

### Tables

Identity and social: `profiles`, `friendships`, `groups`, `group_members`, `group_invitations`.

Expenses and accounting: `expenses`, `expense_payers`, `expense_participants`, `expense_items`, `expense_item_assignments`, `ledger_entries`, `settlements`.

Other: `recurring_expenses`, `recurring_occurrences`, `attachments`, `comments`, `notifications`, `notification_preferences`, `audit_events`, `exchange_rates` (only if conversion is implemented).

`settlement_allocations` (linking repayments to specific expenses) is **not needed** in v1 because balances are net, as in Splitwise. Add it only if a concrete feature requires it.

### Key modeling rules

- `expenses.group_id` is nullable; a null group means a direct friend expense. Direct expenses must have exactly the participants involved, and both must be friends.
- Every expense, payer row, participant row, ledger entry, and settlement stores `currency` (ISO 4217 code) and amounts as `bigint` minor units with `CHECK (amount > 0)` (or `>= 0` where zero is meaningful, e.g. an excluded item share).
- Expenses have a `status` (`active`, `cancelled`) and a `version` integer for optimistic concurrency.
- Expenses and settlements have a client-generated `idempotency_key` with a unique constraint scoped to the creator.
- `settlements.group_id` is nullable, like expenses: a settlement belongs either to one group or to the direct friend relationship.
- Expense dates are stored as `date` (the day the expense happened, no timezone); all event timestamps are `timestamptz`.
- A trigger on `auth.users` insert creates the matching `profiles` row.

### Ledger as the source of truth for balances

- `ledger_entries` are **pairwise**: each row says `debtor_id` owes `creditor_id` an `amount` in a `currency`, within a `group_id` (nullable for direct), linked to exactly one expense or settlement and its version. A per-user net-only ledger is not enough, because friend balances and "who owes whom" cannot be derived from nets when an expense has multiple payers.
- For an expense, each participant's net debt is allocated to the payers in proportion to what each payer paid in excess of their own share (largest remainder method for rounding). A person's net balance is the sum of what others owe them minus what they owe others; across any group this sums to zero per currency.
- A settlement writes one pairwise entry in the opposite direction (the payer's debt to the receiver decreases).
- Ledger entries are **append-only**. Editing an expense writes reversing entries for the old version and new entries for the new version; cancelling writes reversing entries only. Ordinary clients cannot `UPDATE` or `DELETE` ledger rows.
- Balances are computed from the ledger (a view or SQL function), never stored as a mutable running total that could drift.
- Settlements create ledger entries **only when completed**. Pending, rejected, and cancelled settlements have no balance effect.

### Transactions — important

The Supabase JS client cannot run multi-statement transactions. Every operation that writes more than one row of financial state (create/edit/cancel expense, complete/cancel settlement, generate recurring occurrence, accept invitation) must be a **PostgreSQL function** (PL/pgSQL) called via `supabase.rpc()`. Inside the function: verify the caller (`auth.uid()`) and their membership, validate amounts and invariants, lock the relevant rows (`SELECT ... FOR UPDATE` on the expense or group) to prevent concurrent conflicting edits, check the expected `version`, and write everything in one transaction. Use `SECURITY INVOKER` where RLS suffices; use `SECURITY DEFINER` with `SET search_path = ''` and explicit authorization checks only where necessary (e.g., writing audit rows).

**Split math lives in one place.** The TypeScript accounting module is the only implementation of split and pairwise-allocation logic. Server Actions run it on the server (never trusting amounts computed in the browser), then pass the final participant shares and pairwise entries to the database function. The database function does not re-implement splitting; it validates invariants (payers sum to total, shares sum to total, pairwise entries reconcile with shares, everyone involved is a current member, amounts positive, currency consistent) and rejects anything that fails. Do not write a second copy of the split algorithm in SQL.

### Deletion and history

- Historical financial records must not disappear when a member leaves a group or a user deletes their account.
- Leaving a group is allowed only when the member's balance in that group is zero in every currency (Section 2). Former members keep read access to their own history but cannot act.
- Account deletion **anonymizes** the profile (display name becomes "Deleted user", email and avatar removed, auth user deleted) while keeping expense and ledger rows intact so other members' balances remain correct. Use `ON DELETE RESTRICT` or `SET NULL` deliberately; never `CASCADE` from a profile into financial tables.

### Migration rules

- Every schema change is a migration in `supabase/migrations/`. No manual production edits.
- `seed.sql` creates synthetic users and data for local development only. Never insert demo data into real accounts.
- Test migrations against a fresh database (`supabase db reset`).
- Regenerate TypeScript types after each migration.
- Document setup and reset procedures in `docs/database.md`.
- Never use a secret key in browser code.

## 7. Financial accounting engine

The most important part of the app. Build and test it as pure TypeScript functions before any dependent screen.

### Money representation

- Amounts are integers in the currency's minor unit, using the ISO 4217 exponent per currency: INR/USD/EUR/GBP have 2 decimals, JPY has 0, KWD/BHD have 3. Keep a currency table in `lib/money` and never assume 2 decimals.
- In PostgreSQL, store as `bigint`. In TypeScript, use `number` restricted to safe integers (validate with `Number.isSafeInteger` at every boundary) rather than JS `bigint`, because `bigint` is not JSON-serializable and cannot pass from Server to Client Components. Document this decision and the resulting maximum amount.
- Never use floating-point arithmetic for money. Parse user input strings like `"123.45"` directly to minor units without `parseFloat`.
- Percentages are stored as integer **basis points** (100% = 10,000). Weighted shares are positive integers.
- Format for display with `Intl.NumberFormat` and the user's locale (default `en-IN`, which shows ₹1,23,456.78).

### Sign convention

Positive balance = others owe this person. Negative balance = this person owes. Apply consistently in code, database, UI, and tests.

### Pure functions required

Equal, exact, percentage, weighted-share, and itemized splits; multi-payer expenses; allocation of participant shares to payers as pairwise debts; per-user, per-pair (friend), and per-group balances; partial and full settlements; amendments and reversals; debt simplification; currency-separated reporting.

Add a multi-payer pairwise test: A pays ₹600 and B pays ₹300 for a ₹900 bill split equally among A, B, C. Shares are ₹300 each; A is owed ₹300, B is owed ₹0, C owes ₹300, so the only pairwise debt is C → A ₹300.

### Rounding rule (deterministic)

Use the **largest remainder method**: compute each share's exact fraction, give everyone the floor, then distribute the leftover minor units one at a time to participants with the largest fractional remainders, breaking ties by a stable order (participant order as entered, then user ID). Show each participant's resulting share in the UI, and indicate who received a rounding unit.

### Itemized bills, tax, tip, discounts

- Each item is assigned to one or more participants and split among them (equal by default, weighted optional).
- Tax, service charge, and tip are allocated **proportionally to each participant's pre-tax item subtotal**; discounts likewise reduce shares proportionally. Allow an override to split any of these equally.
- After allocation, apply the largest remainder method so that the final shares sum exactly to the bill total. Document the rule in `docs/architecture.md`.

### Invariants (enforce in code and test; re-check in the database function)

- Sum of payer contributions = expense amount.
- Sum of participant liabilities = expense amount.
- Sum of all balances in a group = 0 for each currency.
- Rounding is deterministic: the same input always gives the same output.
- Excluded members get zero liability.
- Duplicate submissions (same idempotency key) do not create duplicates.
- A settlement is never counted twice.
- Editing or cancelling an expense fully reverses its prior effect.
- Concurrent edits cannot produce inconsistent balances (row locks + version check).

### Mandatory test

A pays ₹900; A, B, C split equally. Net positions: A +₹600, B −₹300, C −₹300 (in paise: +60000, −30000, −30000).

Also test: ₹100 split three ways gives 3334/3333/3333 paise deterministically.

### Debt simplification

- Use a deterministic greedy algorithm: separate by currency; repeatedly match the largest creditor with the largest debtor (ties broken by user ID) and transfer the smaller of the two amounts.
- It must preserve every person's net balance exactly and produce at most n−1 transfers for n non-zero members. Finding the absolute minimum number of transfers is NP-hard in general, so describe the output as "simplified", never "optimal".
- Simplification runs within a group (with a per-group "simplify debts" toggle, on by default). When it is on, that group's suggested transfers are computed from members' net balances, and a settlement between two members who had no direct pairwise debt is valid: it is recorded as a pairwise entry and the group nets stay correct. Label the group view as "simplified" when the toggle is on. It never mixes currencies.
- Friend-level views follow the plan. For a group with the toggle on, what two members owe each other in friend balances, dashboard totals and "settle up everything" (Section 11) is the transfer between them in that group's simplified plan, not their raw pairwise entries. Otherwise, once everyone follows the plan, the group is settled while leftover pairwise rows (for example a cycle A→B→C→A) would still appear owed elsewhere. Groups with the toggle off, and direct expenses, use raw pairwise entries. Show which amounts come from a simplified plan. The raw pairwise ledger stays the source of truth; the plan is computed from it.
- Tests: multiple creditors and debtors, partial settlements, ties and equivalent solutions, all-zero balances, unequal balances, a 50-member group, currency separation, and a property-based test that random balances summing to zero are always fully cleared.

## 8. Authentication and security

Implement: email/password sign-up and login, email verification, password reset, logout, session refresh and expiry, protected routes, profile editing, data export, and account deletion.

### RLS policies

- RLS enabled on every table in the exposed schema. Default deny.
- Profiles: users read/update their own row; other users can read only documented public fields (display name, avatar) of people they share a group or friendship with. Use a view or column-limited function for public fields.
- Group records: only current members can read; former members can read their own historical expenses only.
- Only current group members (and, for direct expenses, the two friends) can read, add, edit, or cancel expenses, per the Section 2 rules. Direct expenses (null `group_id`) need their own policies based on participation, not group membership.
- Settlements: only the payer or receiver can create one; only the receiver can confirm or reject a pending one (Section 2).
- Invitation tokens: random (≥128 bits), stored hashed, single group scope, expiring, revocable, single-use or max-use count. Accepting goes through an RPC function that validates the token and adds membership atomically.
- Removed members cannot perform any future action.
- `audit_events` and `ledger_entries`: insert only through database functions; no client `UPDATE`/`DELETE`.
- Storage: private `receipts` bucket; object path includes the expense ID; policies allow access only to members who can see that expense. Serve files through short-lived signed URLs.
- Avoid RLS policies that query the same table recursively (common with `group_members`); use `SECURITY DEFINER` helper functions such as `is_group_member(group_id)` with a fixed `search_path`.

### Other security requirements

- Server Actions and route handlers re-verify identity and authorization on the server; never rely on hidden UI.
- Validate all input with Zod on the server.
- Uploads: allow only JPEG, PNG, WebP, and PDF, max 5 MB, validate type by content not just extension; compress images client-side before upload to save free-tier storage.
- Rate limiting without Redis: rely on Supabase Auth's built-in limits for auth endpoints; add a simple Postgres-backed limit for invitation creation and other abuse-prone actions.
- Secure error handling: no stack traces or SQL errors shown to users.
- Write `SECURITY.md` covering the threat model, RLS approach, and how to report issues.
- Run the Supabase security and performance advisors (`supabase db lint` / dashboard advisors) before deployment and fix findings.

## 9. UI and responsive design

### Visual direction

Neutral background with green primary accent; strong typography; tabular numerals for money; restrained cards, borders, and shadows; consistent spacing; WCAG AA contrast. Light and dark themes. Loading skeletons and useful empty states. Accessible keyboard navigation and screen-reader labels. Do not rely on color alone for owed/owing: pair green/red with text ("you are owed", "you owe") and signs.

### Navigation

Mobile: bottom navigation (Dashboard, Groups, Friends, Activity) with a prominent Add Expense button, plus a menu for secondary pages. Desktop: sidebar with a wider content area. Respect safe-area insets on phones.

### Required screens

1. Landing page and authentication
2. Onboarding (set name, default currency)
3. Dashboard
4. Friends list and friend detail
5. Groups list and group creation
6. Group detail: balances, members, expenses, settlements, activity
7. Add / edit expense
8. Expense detail and history
9. Settle-up flow
10. Recurring expenses
11. Analytics and reports
12. Notifications
13. Profile and settings
14. Invitation acceptance
15. Search results
16. Privacy, data export, and account deletion

### Dashboard

Total you owe, total owed to you, and net position (each per currency); outstanding balances by person (both following each group's simplified plan where the group simplifies debts, Section 7); group summaries; recent activity; recent settlements; quick actions (add expense, create group, invite friend, settle up). Label clearly so that gross spending, net balances, and repayments are never confused.

## 10. Expense features

Description, amount, currency, one or multiple payers, group or direct friend, participants and exclusions, equal/exact/percentage/weighted/itemized splits, optional tax, tip, service charge, and discounts, date, category, notes, tags, receipt. Edit, duplicate, cancel, and full version history (who changed what, when, with before/after amounts).

Validate every split live in the form and again on the server. Show each participant's share and any rounding unit before saving. All writes go through the transactional database functions in Section 6.

## 11. Settlements

- Partial and full repayments; methods: cash, bank transfer, UPI (manual record), other.
- Optional UPI transaction reference field. **Do not** initiate, receive, or verify UPI payments; there is no payment-provider integration. A `upi://pay` deep link to open the payer's UPI app with the amount prefilled is acceptable if clearly labeled as a convenience, and the settlement is still recorded manually.
- States: `pending`, `completed`, `cancelled`, `rejected`. Only `completed` affects balances.
- Suggested payments come from debt simplification.
- Every settlement belongs to one group or to the direct friend relationship, in one currency. A friend-level "settle up everything" action creates one settlement per group and currency where the two owe each other, inside a single transaction, so each group's balances stay correct. For a group that simplifies debts, the amount is the transfer between the two in the group's simplified plan (Section 7); for direct expenses and groups that don't simplify, it is the raw pairwise balance. Groups that either person has left are settled inside the group, not from here. The server computes the amounts; the database checks each one (raw: exactly the pairwise balance; simplified: the right direction and no more than either member's net).
- Idempotency key prevents duplicate settlements.
- Balances recompute automatically from the ledger after any change.

## 12. Recurring expenses

- Configure frequency (daily, weekly, monthly, yearly), start date, optional end date, payer(s), participants, amount, split rule, group, and timezone (default Asia/Kolkata). Pause, resume, cancel.
- Handle month-end correctly (e.g., a monthly expense on the 31st falls on the last day of shorter months).
- The recurring template stores the **resolved** participant shares and pairwise entries (computed by the TypeScript module when the template is saved or edited). The scheduled SQL generator only copies them into a new expense, so no split logic is needed in SQL. Editing the amount or split recomputes the stored shares for future occurrences only.
- Each occurrence has a row in `recurring_occurrences` with a unique `(recurring_expense_id, occurrence_date)` constraint so retries never create duplicates.
- **Scheduling:** Use Supabase `pg_cron` to call a PL/pgSQL function daily that creates due occurrences (catching up any missed ones). This avoids depending on Vercel's Hobby cron, which allows only once-per-day schedules with imprecise timing. Vercel cron calling a secured route is an acceptable alternative if documented.
- Development: provide an npm script or SQL command to run the generator manually. Do not assume any local process runs continuously.

## 13. Multi-currency

- INR is the default; support USD, EUR, GBP, and other common ISO 4217 currencies with correct exponents.
- Users set a default currency per profile and per group.
- Original currency and amount are stored permanently and never rewritten.
- Balances stay separated by currency. A "show approximate total in INR" view is allowed only as clearly labeled display, using stored rates.
- If conversion is implemented, store rate, provider, and retrieval time in `exchange_rates`. A free, keyless source such as the Frankfurter API (ECB reference rates) is preferred. Basic expense tracking must never depend on an exchange-rate API.

## 14. Analytics and exports

- Spending by category and by group; weekly and monthly trends; largest expenses; recurring cost summary; expense and repayment history with date filters, search, sorting, and pagination.
- Clearly distinguish: **paid** (money you put in), **your share** (what you consumed), **owed** (net balance), and **settlements** (repayments). "Spending" in analytics means *your share*, not what you paid.
- Charts use real authorized data, have accessible labels, and offer a table view.
- CSV export (generated on the server, respecting RLS).
- Printable reports via a print stylesheet (browser "Save as PDF"); add a PDF library only if needed.

## 15. Notifications and invitations

- In-app notifications for group invitations, new expenses, expense edits/cancellations, settlement updates, and recurring expense creation.
- Unread count, mark as read, mark all as read, per-type preferences.
- Create notifications inside the same database functions that perform the action, so they cannot be missed or faked.
- Supabase Realtime for live unread counts is optional; polling on navigation is acceptable for v1.
- Invitations: shareable link and/or email; secure tokens as in Section 8.
- Email: Supabase's built-in email sender is heavily rate-limited and meant for testing only. For real use, configure custom SMTP with a free-tier provider (e.g., Resend or Brevo) for auth emails. Document limits and required credentials. Transactional emails beyond auth are optional; the core app must work without them.

## 16. PWA and mobile

- Web manifest via `src/app/manifest.ts`, icons (including maskable), theme colors.
- Service worker with a minimal strategy: cache static assets and an offline fallback page only. **Never cache authenticated pages or API/financial responses.**
- Show a clear offline banner and network error states. Disable submit buttons while pending; idempotency keys make retries safe.
- No offline writes in v1. Never show an action as successful before the server confirms it.
- Mobile-friendly forms: numeric keypad for amounts (`inputMode="decimal"`), touch targets ≥44px.

## 17. Testing

### Unit (Vitest)

All split types; rounding (including the ₹100 ÷ 3 case); zero, negative, and oversized amounts; invalid percentages (not summing to 100%); multi-payer; exclusions; itemized with tax/tip/discount; partial settlements; edits and reversals; currency separation and exponents (JPY, KWD); debt simplification including property-based tests (use `fast-check`); idempotency logic; amount parsing from strings.

### Database / integration (pgTAP + Vitest against local Supabase)

Constraints; RLS for every table using synthetic users (member, non-member, removed member, anonymous); expense RPC functions (create, edit, cancel, concurrent edit with stale version rejected); ledger sums to zero; settlement state transitions; invitation token misuse (expired, revoked, wrong group, reused); duplicate idempotency keys; storage policies.

### End-to-end (Playwright)

1. User A signs up and creates a group.
2. A invites B and C; they sign up and join via the invite link.
3. A adds ₹900 paid by A, split equally.
4. Dashboards show A +₹600, B −₹300, C −₹300.
5. B records a ₹100 repayment to A; A confirms it.
6. Balances update to A +₹500, B −₹200, C −₹300.
7. A adds a second expense with a percentage split; balances update correctly.
8. Each member views their expense history.
9. A fourth user, D, cannot access the group's pages or data (UI and direct API/RPC calls).

For E2E email verification, run against local Supabase and read emails from its local mail inbox (Mailpit/Inbucket), or disable confirmation in the test environment only. Use isolated test data; never run tests against production.

## 18. Environment variables

`.env.example`:

```
NEXT_PUBLIC_APP_URL=http://localhost:3000

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=   # sb_publishable_...
SUPABASE_SECRET_KEY=                    # sb_secret_... server-only, never NEXT_PUBLIC_

# Recurring job / cron route protection (only if a cron HTTP route is used)
CRON_SECRET=

# Optional custom SMTP (configured in Supabase dashboard for auth emails)
# Optional email provider for app emails
EMAIL_PROVIDER_API_KEY=
EMAIL_FROM_ADDRESS=

# Optional exchange-rate provider (leave empty to use a keyless provider or disable conversion)
EXCHANGE_RATE_API_KEY=
```

- Validate env vars at startup in `src/lib/env.ts` with Zod, separating client and server variables; fail with a helpful message when something is missing.
- Import the admin (secret-key) Supabase client only from files marked `import "server-only"`.
- `.env.local` stays out of Git.

## 19. Low-cost development and deployment

### Local development

- Node.js LTS compatible with the installed Next.js version.
- Local Supabase via the Supabase CLI requires Docker (Docker Desktop on Windows, ideally with WSL2). If Docker is unavailable, use a separate free hosted Supabase project as the dev database and document the differences (no local mail inbox; be careful never to point tests at production).
- README must give exact commands for: installing dependencies, starting Supabase locally, applying migrations and seed (`supabase db reset`), generating types, configuring `.env.local`, running the dev server, running each test suite, and building for production.

### Deployment

- Vercel Hobby for the app; Supabase Free for the database, auth, and storage.
- Production steps in `docs/deployment.md`: create the Supabase project, link it, push migrations (`supabase db push`), set auth redirect URLs and site URL, configure custom SMTP, create the storage bucket and policies, enable `pg_cron` and schedule the recurring job, set Vercel environment variables, deploy, run a smoke test.
- Document free-tier constraints: Supabase Free projects pause after a period of inactivity and have database/storage size limits; Vercel Hobby is for non-commercial use and limits cron frequency. Check current limits in official docs rather than hardcoding numbers.
- Separate preview/staging data from production; never run seed or destructive scripts against production.

## 20. Quality bar (applies to every milestone)

- `npm run lint`, `npm run typecheck`, `npm test`, `supabase test db`, and `npm run build` all pass.
- No `any` without a justifying comment; no unhandled promise rejections; no console errors on key pages.
- New features have tests; accounting changes have unit tests and database tests.
- Lighthouse accessibility ≥ 90 on key mobile pages (from M9).
- No secrets in the repository (check before every commit).

## 21. Milestones

Complete in order. Each milestone ends with the Section 0 end-of-milestone routine.

**M0 — Foundation.** Initialize Next.js + TypeScript strict + Tailwind + shadcn/ui + ESLint + Vitest + Playwright. Set up Supabase CLI and local stack. Create `CLAUDE.md`, `docs/SPEC.md` (this file), `IMPLEMENTATION_PLAN.md`, `.env.example`, `src/lib/env.ts`, brand config. *Done when:* dev server runs, a trivial test passes in each runner, and the build succeeds.

**M1 — Money and accounting engine (no UI).** `lib/money` (currency table, parsing, formatting) and `lib/accounting` (all splits, rounding, itemized allocation, balances, reversals) and `lib/settlements` (simplification). *Done when:* all Section 7 tests, including property-based tests, pass.

**M2 — Database schema, RLS, and transactional functions.** All migrations, helper functions, RLS policies, storage bucket and policies, RPC functions for expenses, settlements, and invitations; seed data; generated types; pgTAP tests. *Done when:* `supabase db reset` works from scratch and all database tests pass, including RLS denial tests.

**M3 — Auth and app shell.** Sign-up, verification, login, reset, logout, session refresh, protected routes, onboarding, profile settings, responsive layout with bottom nav / sidebar, themes. *Done when:* a user can sign up locally, verify, log in, and see an empty dashboard on mobile and desktop. Then do a **first staging deployment** (with my approval): a hosted Supabase project plus a Vercel preview, so auth redirect URLs, cookies, and email settings are proven early rather than at the end.

**M4 — Friends, groups, invitations.** Friend requests by email, group CRUD, member management, invite links, invitation acceptance, leave-group rules. *Done when:* E2E steps 1–2 pass.

**M5 — Expenses.** Add/edit/duplicate/cancel with all split types, multi-payer, itemized with tax/tip/discount, live share preview, history view, comments. *Done when:* E2E step 3 passes and edit/cancel are reflected correctly in balances.

**M6 — Balances, dashboard, settlements.** Group and friend balances, dashboard, simplify-debts suggestions, settle-up flow with states, settlement history. *Done when:* E2E steps 4–9 pass. **M0–M6 is the usable MVP**: after M6, deploy to staging so real friends can try it while later milestones continue.

**M7 — Recurring expenses and receipts.** Recurring setup and controls, `pg_cron` generator with idempotent occurrences, receipt upload with compression and signed URLs. *Done when:* manually running the generator twice creates each occurrence exactly once, and receipt access is denied to non-members.

**M8 — Notifications, search, analytics, exports.** In-app notifications and preferences, search, analytics charts with table views, CSV export, print stylesheet. *Done when:* each feature has tests and charts match database totals.

**M9 — Multi-currency conversion, PWA, privacy, hardening, deployment.** Optional conversion with stored rates, manifest and service worker, data export and account deletion (anonymization), security review against Section 8, advisors clean, accessibility pass, deployment docs, production deploy, and smoke test. *Done when:* the full E2E suite passes against a staging deployment and `SECURITY.md` and `docs/deployment.md` are complete.

## 22. Final report after each milestone

Reply with: what was built, test results (counts and anything skipped), how to try it locally, known limitations, anything you need from me (credentials, decisions), and the next milestone.

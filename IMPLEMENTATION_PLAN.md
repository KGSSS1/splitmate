# SplitMate — Implementation Plan

## Handoff note (latest first)

### 2026-10-24: M7 Recurring expenses and receipts complete (staging push pending approval)

- **Migration** `20261024090000_recurring_receipts.sql`:
  - `recurring_expenses` gains `updated_by`, `idempotency_key` (unique per creator), `notes`, `tags`, `items` and an `ended` status. New notification type `recurring_failed`.
  - Schedule: `private.recurring_date` / `recurring_next_date` count from the start date (31st → last day of shorter months → 31st again; 29 Feb → 28 Feb in common years).
  - `private.validate_expense_payload` checks a template's stored payload by writing it as an expense inside an always-rolled-back block, so templates get exactly the `create_expense` checks without a second copy of them.
  - RPCs `create_recurring_expense`, `update_recurring_expense` (future occurrences only; returns the same version on a no-op save) and `set_recurring_expense_status` (pause / resume / cancel). Resuming skips the dates that passed while paused. All audited.
  - Generator `private.generate_recurring_expenses(p_now, p_recurring_id)`: due = on or before today in the template's time zone; catches up (≤ 100 per template per run); occurrence row first (unique `(template, date)`), then the expense as the template's creator with a deterministic idempotency key. A failure is recorded on the occurrence, pauses the template and notifies its creator.
  - `pg_cron` job `splitmate-recurring-expenses`, **hourly** (`5 * * * *`). SPEC §12 says daily; hourly means each template is added soon after midnight in its own time zone, and re-runs are harmless. Say if you'd rather have daily.
  - Receipts: `attachments.file_name`; a trigger allows at most 10 per expense and requires the row to point at an object the uploader owns.
- **App:**
  - The Add expense form has a **Repeat** section (frequency, "Ends on", time zone defaulting to the profile's), with the rule in words and the next three dates. `?repeat=monthly` preselects it.
  - Pages `/recurring` (in the secondary nav), `/recurring/[id]` (schedule, split, expenses added and failed dates, Pause/Resume/Cancel) and `/recurring/[id]/edit` (the same form, mode `edit-recurring`).
  - Generated expenses link back to their template.
  - **Receipts** on the expense page:
    - A Server Action creates a signed upload URL, which runs the bucket's insert policy as the caller.
    - The browser shrinks photos (≤ 2000 px, WebP or JPEG) and PUTs the file straight to Storage. Vercel caps request bodies below 5 MB, so files don't go through the app server.
    - A second action downloads the file and checks its magic bytes, the type it is served with and its size. Only then does it insert the row; otherwise it deletes the file.
    - Files open through `/expenses/[id]/receipts/[attachmentId]`, which re-checks access and redirects to a 60 s signed URL. The uploader can remove their own.
  - New modules:
    - `src/lib/recurring/schedule.ts`;
    - `src/lib/receipts/{files,compress}.ts`;
    - `src/lib/validation/{recurring,receipts}.ts`;
    - `src/server/{recurring,receipts}.ts`;
    - `src/server/actions/{recurring,receipts}.ts`.
  - `expenseRpcArguments` moved from the expense actions to `src/lib/expenses/payload.ts` (shared with templates). The expense schema exports `baseExpenseSchema` and `refineExpense`.
- **npm script:** `npm run db:recurring` runs the generator once via `docker exec supabase_db_splitmate psql` and prints how many expenses it created. Running it twice in a row printed `0` both times locally (nothing was due).
- **Tests:**
  - pgTAP `160_recurring_receipts` (80): month ends, 29 Feb and schedule arithmetic, generator run repeatedly (each occurrence once), catch-up, time zones, end dates, create/edit/pause/resume/cancel checks with exact messages, failed occurrences, the cron job, receipt limit and ownership, non-members denied. `020` and `070` fixtures now upload the object before attaching it (new trigger). `020` selects its own template only, since the integration suite leaves committed data behind.
  - Unit (+40):
    - schedule (including a property test against the same cases);
    - receipt sniffing, names and sizes;
    - five repeat tests in the expense form;
    - 18 action tests (`tests/unit/server/recurring-receipt-actions.test.ts`).
  - Integration `recurring-receipts` (2):
    - an RPC template, the generator run twice with exactly one expense, outsider SM404;
    - a real signed upload, opening by a member, and an outsider denied through download, signed URL, signed upload and list.
  - E2E `recurring-receipts.spec.ts` (2 × 2 viewports): monthly expense saved from the form, today's expense in balances, pause/resume, edit for the future (the first expense keeps ₹20,000), outsider 404, cancel; PDF and PNG receipts, a fake PDF refused, a member opening it via the redirect, outsider 404, remove.
  - The axe spec covers `/recurring`, `/recurring/[id]`, `/recurring/[id]/edit`, `/expenses/new?repeat=monthly` and an expense with a receipt. The focus and touch-target tests got 120 s timeouts (their setup now does more).
- **Checks:**
  - `db reset` from scratch ✓ (19 migrations); types regenerated; lint, typecheck and build ✓; `db lint` and advisors ✓ (no issues).
  - Unit 547 ✓. Integration 27 ✓. pgTAP 556 ✓.
  - Playwright 48 passed, 2 skipped (phone-only tests on desktop) with `--workers=2`.
  - The first pgTAP run in the full sequence failed in `020` because of the integration test's leftover "Rent" template (fixed as above). The rerun passed.
- **Known limitations:**
  - Receipts are added from the expense page only, not inside the Add expense form.
  - An upload abandoned between the PUT and the attach step leaves an orphan object with no row; nothing cleans those up yet.
  - Notifications (`recurring_created`, `recurring_failed`) are written but have no UI until M8.
  - Itemized templates go through the same validation, but no test covers one specifically.
  - If the template's creator leaves the group, its future occurrences fail and pause it. Another member can't take it over.
- **Staging:** not pushed. The migration creates the `pg_cron` extension and job on the hosted project when pushed, so it needs your approval (dry run first).
- **Next:** with approval, push M7 to staging; then M8 (notifications, search, analytics, exports).

### 2026-10-24: Review follow-ups, batch 3 (polish and accessibility)

- **Fixed:** M7, M8, M11, L3, L16, L17, L18, L19, L20, L22, L24, L26, L27, L28, L29, L32. The table is in `docs/reviews/review-M6.md` under "Batch 3".
- **New dev dependency:** `@axe-core/playwright` 4.13.0 (exact). `tests/e2e/accessibility.spec.ts` runs axe on 17 app pages in both themes and both viewports, and checks keyboard focus on list rows, 44 px phone targets and the 375 px itemized form.
- **Theme:**
  - Light `--muted-foreground` is now `oklch(0.5 0 0)`.
  - `--primary-emphasis` / `--destructive-emphasis` are for text on 10 % tints.
  - Brand colours are unchanged.
- **New modules:**
  - `src/components/shared/row-link.ts`;
  - `src/components/forms/redirect-notice.tsx`;
  - `src/lib/groups/copy.ts`;
  - `src/app/(app)/not-found.tsx`.
- **Checks:**
  - `db reset` ✓; types unchanged; lint, typecheck and build ✓; `db lint` and advisors ✓.
  - Unit 507 ✓. Integration 25 ✓. pgTAP 476 ✓.
  - Playwright 44/44 ✓ (`--workers=2`), including axe.
  - In the first full run one phone test timed out waiting for "Create invite link" (the action was still pending after 5 s under load). It passed 3/3 alone, and the whole suite passed 44/44 when rerun.
- **Staging (approved 2026-10-24):**
  - The dry run showed only `20261023090000`, `20261023091000` and `20261023092000`, with no seed or roles. They were pushed, and remote history matches local (18 migrations).
  - `db lint --linked` is clean. The advisors show 25 rule-0029 WARNs, the expected 22 plus `group_names`, `group_invitation_list` and `withdraw_friend_request` (intended authenticated RPCs with their own checks).
  - `staging` was pushed (`fee6ed1`). The Vercel preview `splitmate-7sv6gr1yr` was Ready in 43 s.
  - **Smoke test** through the deployment URL: the landing page returns 200; `/dashboard`, `/friends`, `/settle-up`, `/activity`, `/settlements` and an in-app 404 path redirect to login; the CSP `frame-ancestors`, `X-Frame-Options`, `nosniff` and `Referrer-Policy` headers are present and `X-Powered-By` is absent. Not checked while logged in.
- **Known:** `npm audit` reports one high advisory in `body-parser`, reached via `shadcn` → `@modelcontextprotocol/sdk` → `express`. That is the shadcn CLI's MCP server, which the app never runs. It predates this work and is not fixed here.

### 2026-10-24: Review follow-ups, batch 2 (test hardening)

- **Fixed:** M17, M12, M13, M14, M15, M16, L33, L34, L37, L40, L41, L42. The table is in `docs/reviews/review-M6.md` under "Batch 2". Each new test was checked against the mutation it targets.
- **M17 root cause:** state set after an `await` inside `startTransition` commits outside the transition, so errors rendered while the button was still disabled. Post-await updates are wrapped in a second `startTransition` (`use-action-submit`, `ActionButton`, invite panel, resend confirmation).
- **Also:**
  - `SubmitButton` is disabled until hydration: an early click used to GET the page with form values in the URL.
  - "Cancel" on a pending payment now says it was withdrawn.
  - L34 found that `090` #1 had silently switched to the new M3 guard; it now tests the routing guard again.
  - fast-check runs with a fixed seed (`FC_SEED` overrides it).
- **Tests added:**
  - pgTAP `150_review_batch2` (13);
  - unit: `use-action-submit`, `action-button`, `submit-button`, `fast-check-seed`, and `tests/unit/server/{auth,balances,settlement-actions,expense-friend-actions}`;
  - the E2E simplified-plan test checks both suggestion lists.
- **Checks:**
  - `db reset` ✓; types unchanged; lint, typecheck and build ✓; `db lint` and advisors ✓.
  - pgTAP 476 ✓. Integration 25 ✓. Playwright 38/38 ✓ (`--workers=2`).
  - Unit 491 ✓, 10 runs in a row with zero failures.

### 2026-10-24: Review follow-ups, batch 1 (correctness, trust and security)

- **Decisions (product owner):** fix the chosen Medium/Low findings in three batches, each committed before the next; push to staging only after all three. The five suggested spec changes are in `docs/SPEC.md`, plus a `withdrawn` settlement status, a neutral friend-request reply (L8) and a per-currency maximum expense amount (M2). The batch tables are in `docs/reviews/review-M6.md` under "Follow-up batches".
- **Batch 1 fixed** (each reproduced by a failing test first): withdrawn status, M1, M2, M3, M4, M5, M6, M9, L2, L7, L8, L9, L10, L11, L12, L13, L14.
- **Migrations:**
  - `20261023090000_settlement_withdrawn.sql`: `withdrawn` status and backfill; `cancel_settlement`, `end_membership` and `my_activity` updated; `settle_up_with_friend` refuses a context with a pending payment between the pair (L2).
  - `20261023091000_expense_integrity.sql`: membership share locks on edit/cancel (M1); `currency_max_amount` and the ledger balance-range trigger (M2); `check_split_details` (M3); fuller snapshots and no-op saves (M4).
  - `20261023092000_reads_and_privacy.sql`: `direct_expenses_with` (M6); `friend_email_requests`, neutral `send_friend_request`, `withdraw_friend_request`, apply-on-signup triggers (L7, L8); `group_names` and `left_group_name` (L9); no direct group UPDATE (L10); `group_invitation_list` and masked audit addresses (L11).
- **App:** `requireLiveSession()` on sensitive actions (L12); HttpOnly/SameSite/Secure session cookies (L13); security headers (L14); `formatTimestamp` in the profile time zone (M9); "You borrowed / You lent" wording (M5); paged direct expenses on the friend page (M6).
- **Tests:** pgTAP `140_review_batch1` (46); integration `review-races`, `direct-expenses`, `session-revocation`; unit tests for dates, live session, expense list, currency limits, history, friend view, lifecycle, activity, request outcome; E2E cookie and header checks.
- **Checks:**
  - `db reset` from scratch ✓ (18 migrations); generated types updated; `db lint` and advisors ✓.
  - Lint, typecheck and build ✓.
  - pgTAP 463 ✓. Integration 25 ✓. Playwright 38/38 ✓ (`--workers=2`).
  - Unit 441/443: the two failures are the known M17 flakes (expense-form and settle-up-form retry tests). They are batch 2's first item, as decided.
- **Not pushed:** the three migrations and the branch wait for batches 2 and 3, then approval.

### 2026-10-22: Friend balances follow simplified plans (review H3, option 1)

- **Decision (product owner):** in groups that simplify debts, friend-level views use the group's simplified plan instead of raw pairwise rows. Direct expenses and non-simplifying groups are unchanged. SPEC §2, §7, §9 and §11 are updated.
- **Code:**
  - `src/lib/settlements/friend-view.ts`, pure:
    - `friendContextBalances` builds raw rows for direct expenses and non-simplifying groups, and `simplifyDebts` transfers for simplifying groups;
    - `settleableWith`.
  - `src/server/balances.ts`:
    - `loadContextBalances(client, viewerId)`, memoized per request as `getMyContextBalances`;
    - it feeds the dashboard totals, "Balances by person", the friends list, the friend page breakdown (labelled "simplified") and "Settle up everything".
  - Migration `20261022120000_simplified_friend_view.sql`:
    - `my_pairwise_balances()` and `my_simplified_group_balances()`;
    - `settle_up_with_friend` now takes server-computed `items` and validates each one: raw contexts must match exactly; simplified groups need the right direction and no more than either net (SM409 when stale).
    - It re-checks the batch after the lock (review L1).
    - The old signature is dropped.
- **Tests:**
  - New unit tests for the friend view (including a property test).
  - pgTAP `120` rewritten: 44 assertions, including a group where the plan differs from raw.
  - The H3 integration tests are now real tests (4).
  - Reviewer A's differential test expects the engine's plan for groups; seeds 1–3 and the default pass.
  - New E2E: "friend balances follow the group's simplified plan".
- **Checks:**
  - `db reset` from scratch ✓; types unchanged; `db lint` and advisors ✓.
  - Lint, typecheck and build ✓.
  - Unit 416 ✓. Integration 20 ✓. pgTAP 416 ✓.
  - Playwright 33/34 in the full run (`--workers=2`). The one failure was the outsider check on `/groups/[id]/settings` timing out with an empty `<main>`: the page hadn't rendered and showed no data. It passed on both viewports when rerun.
- **Note:** `my_activity`'s efficiency depends on table statistics. `130_review_m6` runs `analyze` after inserting its 1,500 rows, as autovacuum would; without statistics the planner scans every event.
- **Staging (approved 2026-10-22):**
  - Migration `20261022120000` was pushed after a dry run that showed only that file, with no seed. Remote history matches local (15 migrations).
  - `db lint --linked` is clean. The advisors show the same 22 expected rule-0029 WARNs; the new read functions are SECURITY INVOKER.
  - `staging` was pushed (`32871bf`). The Vercel preview `splitmate-pean1bi6b` was Ready in 34 s, and the branch URL points to it.
  - **Smoke test** through the deployment URL: the landing page loads, and `/dashboard`, `/friends`, `/settle-up`, `/activity` and `/settlements` redirect to login.
  - This machine's connection to Vercel drops intermittently, and the branch hostname's edge IPs are unreachable from here. Not checked while logged in.

### 2026-10-22 — Independent review of M0–M6

- **Review:** six fresh reviewers (accounting, database security, application security, spec conformance, test quality, code quality) worked from the repo and SPEC only. The merged, de-duplicated findings are in `docs/reviews/review-M6.md`: 0 Critical, 6 High, 18 Medium, 41 Low (the rejected-settlement test gap, first rated High, was re-rated Medium on the second pass; it is fixed too).
- **Fixed (High), each reproduced by a failing test first:**
  - **H1 open redirect** through a dot-segment `next` (`/.//host`): `safeNextPath` now decodes the path and rejects `.`/`..` segments, `//` and `\`. Unit cases plus an E2E test (the old code sent the browser off-site).
  - **H2 removed member rejoining** through someone else's older link: `accept_invitation` refuses invitations created before the removal (migration `20261022060000_review_m6_fixes.sql`).
  - **H4 activity feed cost:**
    - `my_activity()` collects candidates from the caller's own data, and RLS still decides visibility.
    - Visibility checks for a 25-row page dropped from ≥1,500 (one per event in the system) to <100.
    - `(actor_id, created_at)` index.
  - **H5 N+1:** `listMyGroups` makes one `my_group_balances()` call.
  - **H6 / H7 test gaps:**
    - rejected settlements are now checked against the ledger;
    - RLS tests cover former members' settlements, item lines, item assignments and recurring occurrences;
    - a generic "outsider sees nothing in any exposed table" check covers future tables. Each was verified against the mutation that used to pass.
- **Reproduced, needs a decision: H3.** Simplify-on groups vs raw pairwise friend balances. After following the simplified plan, dashboards and friend pages still show a pairwise cycle, and "Settle up everything" unbalances the settled group. This is the SPEC §7 rule itself, so it is left as is. `tests/integration/simplified-friend-balances.test.ts` uses `it.fails` and will flip once it's fixed. The options are in the review.
- **Kept from the review:** `tests/integration/differential-review.test.ts` (reviewer A). It checks the DB against the TS engine on random sequences, and passed seeds 1–8 (4,800 operations) plus a race test.
- **Not done:** the Medium and Low findings wait for a decision; each has a recommendation in the review. M1 (leave vs cancel race) and M2 (balance sums beyond 2^53) are the first ones I'd fix.
- **Checks after the fixes:**
  - `db reset` from scratch ✓ (14 migrations; generated types unchanged); lint, typecheck and build ✓; `db lint` and advisors ✓.
  - pgTAP 405 ✓ (+26). Integration 17 ✓, plus 2 expected-fail H3 reproductions.
  - Playwright 32/32 ✓ with `--workers=2`. A default-worker run had starved the machine: the dev server grew to 2 GB and free RAM fell below 1 GB.
  - Unit 408/409. The failing test is the pre-existing flaky retry test (review M17): it also failed on the baseline code under load and passes when run alone. Not fixed, because Medium findings wait for a decision.
- **Staging (approved 2026-10-22):**
  - Migration `20261022060000` was pushed to `splitmate-staging` after a dry run that showed only that file, with no seed. Remote history matches local (14 migrations).
  - `db lint --linked` is clean, and the advisors show the same 22 expected rule-0029 WARNs. `my_activity` is SECURITY INVOKER, so it isn't flagged.
  - `staging` was pushed (`c93e380`). The Vercel preview `splitmate-8eblnfza7` was Ready in 34 s, and the branch URL points to it.
  - **Smoke test** through the deployment URL: the landing page loads, and `/dashboard`, `/activity` and `/settle-up` redirect to login.
  - **Not checked from this machine:** the branch URL itself times out (in curl and the browser) because the Vercel edge IPs it resolves to (`64.29.17.195`, `216.198.79.195`) are unreachable from this network or VPN, while the deployment URL's edge works. Check it from a phone.

### 2026-10-22 — M6 Balances, dashboard and settlements complete (staging deploy pending approval)

- **Done:**
  - **Migration** `20261021131200_balances_settle_up.sql`:
    - Read functions over the ledger: `my_group_balances()`, `friend_group_balances(friend_id)` (pairwise per group, null = direct), `group_pairwise_balances(group_id)`. Sums only; RLS applies (SECURITY INVOKER).
    - `create_settlement`'s body moved to `private.record_settlement` (same signature and grants). It now also returns readable SM422s for long UPI references/notes and future dates.
    - `settle_up_with_friend(key, friend_id, method, upi_reference, note, settled_on)`: one settlement per group (and direct) and currency in one transaction. Owed to the caller → completed; owed by the caller → pending. Groups either person left are skipped. `settlements.batch_id` makes retries return the same IDs.
  - **Pages:**
    - Dashboard: owed / owing / net per currency, "Waiting for you to confirm" with Confirm/Reject, balances by person, group summaries, recent settlements, recent activity, quick actions (add expense, settle up, create group, invite a friend).
    - Group **Balances** tab (`/groups/[id]/balances`): member nets, suggested repayments labelled "Simplified" when the toggle is on (raw pairwise debts when off), Record payment / Record as received links, and the group's settlements.
    - **Settle up** (`/settle-up`): pick a group or friend, then person, who paid, amount (prefilled from suggestions or `?person&direction&amount&currency`), currency, method (cash, bank transfer, UPI recorded manually, other), optional UPI reference, date and note. The form says beforehand whether it completes now or waits for the other person.
    - **Settlements** (`/settlements`, `/settlements/[id]`): waiting for you, waiting for others, paginated history; detail with status explanation, history and actions (confirm, reject, withdraw, cancel with reversal).
    - **Friend page:** balance by group, "Settle up everything" (shows which parts complete now and which wait), settlements between you two.
    - **Activity** (`/activity`, nav enabled): expense and settlement history from `audit_events`, worded from the viewer's side with "You owe / You lent".
    - Settlements added to the secondary nav (phone menu, sidebar).
- **Tests:**
  - Unit/component: 400 (+29): suggestions (incl. a property test), available actions, settlement schemas, activity wording, settle-up form (suggestion fill, validation, idempotency key reused on retry).
  - Integration: 14 (+3, `tests/integration/settlements.test.ts`): E2E steps 4–6 numbers via RPCs, settle up everything, outsider D denied.
  - pgTAP: 379 (+33, `120_balances_settle_up`).
  - Playwright: 30 runs pass (15 tests × desktop and Pixel 7, +4 runs).
    - New `tests/e2e/settlements.spec.ts`: E2E steps 4–9 (dashboards, B's ₹100 confirmed by A, percentage expense, each member's activity and expense history, D denied on 8 pages and through direct table/RPC calls with D's own session), plus settle up everything → reject → cancel a completed one → simplify off.
  - `supabase db lint` and local advisors are clean.
- **Decisions to know:**
  - **Pending settlements don't reduce balances or suggestions.** A payer could record the same debt twice; the friend page warns when some are pending. Revisit if testers trip over it.
  - **Simplified transfers between people with no direct debt** create a pairwise ledger row, so friend balances (raw pairwise) can show a debt the group view has netted away. This follows SPEC §7.
  - **E2E timing:** a full run right after `npm run build` failed 12 tests on 5-second navigation timeouts while the dev server recompiled every route; the rerun with a warm cache is the result above. Run E2E before `build`, or expect a cold first run.
  - `tests/e2e/support/api.ts` signs in through supabase-js with the publishable key (local URL only) for API-level denial checks.
- **Not done / known limitations:**
  - No `upi://pay` deep link (we store no UPI IDs).
  - Settlement dates are validated up to tomorrow (time zones), not per profile time zone.
  - Activity shows expenses and settlements only, not membership changes.
- **Staging:**
  - The M6 migration was pushed to `splitmate-staging` on 2026-10-22 (approved; dry run first: only `20261021131200`, no seed). Remote history matches local (13 migrations), and `db lint --linked` is clean.
  - Advisors (warn level) show 22 rule-0029 WARNs: the earlier 21 plus `settle_up_with_friend`. All expected. The new read functions are SECURITY INVOKER and not flagged.
  - The `staging` branch was pushed on 2026-10-22 (approved, `45f2dae`). The Vercel preview built in 57 s (Ready), and the branch URL points to it.
  - The staging URL loads without a Vercel login (HTTP 200), so Vercel Authentication appears to be off now. `/dashboard` and `/settle-up` redirect to `/login`. Not smoke-tested while logged in.
  - Before friends can try it: email delivery (custom SMTP, or confirmation off on staging) and the Auth URL configuration. Both are dashboard settings for you to change.
- **Next:** staging deploy of the MVP (with approval), then M7 recurring expenses and receipts.

### 2026-10-21 — M5 Expenses complete

- **Done:**
  - **No migration.** The M2 RPCs, versioned rows, `audit_events` and `comments` policies already covered M5.
  - **Split logic:**
    - `src/lib/expenses/resolve.ts` turns form strings into total, payers, shares, rounding units and pairwise debts with `src/lib/accounting`. It is shared by the live preview and the Server Actions.
    - `expenseFormSchema` runs it in `superRefine`.
    - `buildExpensePayload` builds the RPC jsonb.
  - **Form** (`src/components/expenses/expense-form.tsx`), mobile first:
    - Fields: split with (group or friend), description, amount (`inputMode="decimal"`), currency, date (today in the profile's time zone), category, one or several payers, notes and tags.
    - Split methods: equal, exact, percentage, shares, and itemized with tax, service, tip and discount (proportional or equal). Exclusions are tick boxes.
    - **Live preview:** shares with a "+1 rounding unit" marker, who owes whom, and what to fix. Save stays disabled until the split is valid and while pending.
    - One idempotency key per form, reused on retry.
  - **Expense page:** paid by, shares (percentages and weights), items, notes and tags.
    - **History:** who added, edited or cancelled it, with before → after for each changed field.
    - **Comments:** add, and delete your own.
    - **Actions:** edit, duplicate (`/expenses/new?from=`) and cancel with confirmation. Locked expenses explain why.
  - **Group pages:** an Expenses tab (default, 20 per page, cancelled expenses labelled, "You lent / You owe" per row). Members moved to `/groups/[id]/members`.
  - **Friend page:** "Add expense" and direct expenses with that friend.
  - Add Expense is enabled in the nav.
- **Tests:**
  - 371 unit/component tests (+49), including:
    - the resolver: SPEC §7 cases, every split method, payers, itemized, determinism;
    - 12 expense-form component tests: save gating, messages, rounding marker, payers, itemized, description check, the idempotency key reused on retry, edit version.
  - Integration tests: 11 (+3, `tests/integration/expenses.test.ts`). They exercise create → idempotent retry → edit (exact reversal rows plus new charges) → second edit → stale version refused → cancel (ledger nets to zero), an itemized bill, and a tampered payload being refused.
  - pgTAP: 346, unchanged.
  - Playwright: 26 runs (13 tests × desktop and Pixel 7).
    - New: E2E step 3 (₹900 split equally → +₹600 / −₹300 / −₹300 on the ledger-backed Members tab), a comment, an edit to ₹1,200 by percentage (+₹900 / −₹600 / −₹300), a cancel (all settled up), and a duplicate.
    - New: a direct expense split by exact amounts, with the friend balance from the ledger.
  - Pagination was checked by hand with 23 expenses (page 2 of 2). The local DB was reset afterwards.
- **Decisions to know:**
  - **Group URLs:** `/groups/[id]` is now Expenses, and Members is `/groups/[id]/members`. Invitation acceptance still lands on `/groups/[id]?joined=1`.
  - **E2E helpers** for groups are in `tests/e2e/support/groups.ts` (`joinThroughInvite`, `openGroupTab`, …). One M3 assertion (`default-email-links`) got a longer timeout: login → dashboard → onboarding is two redirects, which can exceed 5 s under full parallel load.
  - **Categories** are preset keys (`src/lib/expenses/options.ts`). A stored value that isn't a preset (such as the seed's "Groceries") is kept as an option, so editing doesn't wipe it.
  - **Expense history** shows the fields in `private.expense_snapshot`: description, amount, date, category, split, payers, shares. Notes, tags and items are not in the snapshot, so their changes don't appear in the diff.
- **Not done / known limitations:**
  - **Receipts are M7.**
  - **Items:** each item is split equally among the people ticked for it. Weighted item assignments are supported by the engine and the database, but not by the form.
  - **Direct expenses:** only the latest 50 with a friend are listed (from the latest 100 direct expenses). There is no pagination yet.
  - **Display order:** participant order isn't stored, so the detail page lists shares by name. Rounding ties still follow the entry order used when saving.
- **Staging:** M5 has no migration. `staging` was pushed on 2026-10-21 (with approval) and the Vercel preview built (Ready). Not smoke-tested in a browser: Vercel Authentication is still on.
- **Next:** M6, balances, dashboard and settlements. Group balances already come from `group_balances()` on the Members tab; the simplify-debts suggestions and the settle-up flow are next.

### 2026-10-21 — M4 Friends, groups and invitations complete

- **Done:**
  - **Migration** `20261021131100_friends_groups_invitations.sql`:
    - `groups.group_type` (trip / home / couple / other).
    - `create_group` gains type and simplify-debts arguments (old 3-argument signature dropped).
    - New RPCs: `update_group` (admins, audited), `set_member_role` (the last admin can't be demoted), `send_friend_request` / `accept_friend_request` / `delete_friend_request`, `invitation_preview`, `my_group_invitations`.
    - Postgres-backed rate limit table `private.rate_limit_events`: 30 friend-request lookups per hour, misses included.
  - **Pages:**
    - Friends: add by exact email, incoming/sent requests, list, and a detail page with per-currency balance from `friend_balances()` and shared groups.
    - Groups: list with your balance and "Invitations for you", plus create.
    - Group detail: Members tab with per-member ledger balances, admin actions, invite panel, open invitations with revoke, and leave. Settings tab for editing.
    - Public `/invite/[token]` acceptance page.
  - **Nav:** Groups and Friends are now enabled.
  - **Invitations:**
    - A shareable link (10 uses; expires after 1, 7 or 30 days) and email invitations (single-use and bound to the email; the app shows the link plus a `mailto:` draft, and sends no email itself).
    - Link format: `/invite/{token}?group={id}`. A token used with another group's ID is refused.
    - Sign-up from an invitation returns to it: an httpOnly cookie is turned into `/onboarding?next=…`.
  - **Leave / remove** only at zero balance in every currency: the UI explains why when blocked, and the RPCs enforce it.
- **Tests:**
  - 322 unit/component tests (+53). pgTAP 346 (+67, new file `110_friends_groups`). Integration tests: 8, unchanged.
  - 22 Playwright runs: 11 tests × desktop and Pixel 7. They include E2E steps 1–2 and a test that a token can't be used for another group and fails after revocation. Group settings editing is covered in the same spec.
  - `supabase db lint` and advisors (warn level) are clean.
- **Decisions to know:**
  - **Local `supabase/config.toml` auth rate limits** raised to 200: `sign_in_sign_ups` and `token_verifications` (both were 30 per 5 minutes per IP). The full E2E run exceeded the old limits. Hosted settings are unaffected.
  - **`ActionResult<TData>`** can now carry `data` (the new invitation link). `useActionSubmit` accepts any result type.
  - **Shared E2E helpers** live in `tests/e2e/support/accounts.ts`; `newPersonPage()` opens a second person's browser context with the same device settings.
  - **The nav reads `usePathname()` inside `<Suspense>`.** Without it, routes with dynamic segments fail prerendering.
- **Not done / known limitations:**
  - **No notifications UI yet (M8).** Friend-request, invitation and membership notifications are already written to the database.
  - **Missing features:**
    - Removing an accepted friend.
    - Archiving or deleting a group.
    - Real email delivery for invitations (optional per SPEC §15).
  - **Opening the sign-up confirmation in a different browser** loses the way back to the invitation: the user lands on the dashboard and must reopen the link.
  - **Logging in to an app page while not onboarded** goes to onboarding without the original `next` (pre-existing; invitation links are handled).
- **Staging (approved 2026-10-21):**
  - The M4 migration was pushed to `splitmate-staging` (no seed). The remote history matches local (12 migrations), and lint is clean.
  - The advisors show 21 rule-0029 WARNs: the earlier 14 plus the 7 new RPCs. All are expected.
  - The `staging` branch was pushed, and the Vercel preview built (Ready).
  - Not smoke-tested in a browser: Vercel Authentication is still on.
- **Next:** M5, expenses.
  - Add an Expenses tab to the group pages (`src/components/groups/group-tabs.tsx`) and enable Add Expense in `nav-config.ts`.
  - Direct expenses need an accepted friendship (`are_friends`).

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
  - The Supabase staging project `splitmate-staging` (ref `vnjktzhyvfbnyfzppnkw`, ap-south-1) is linked, and all 11 migrations were pushed on 2026-10-21 without seed data.
    - The remote migration history matches local.
    - Lint is clean.
    - The advisors show only the expected rule-0029 warnings (14 SECURITY DEFINER RPCs) and INFO unused-index notices.
  - Auth settings, URL configuration and the phone test are not done yet.
  - Email templates can't be edited without custom SMTP, so hosted staging uses Supabase's default templates (`?code=` links).
    - `/auth/confirm` now exchanges those codes (PKCE) and keeps the `?token_hash=` path for custom templates later.
    - A link opened in a different browser can't be exchanged: the login page explains it, and a sign-up is confirmed anyway.
    - Covered by `tests/e2e/default-email-links.spec.ts` and `tests/unit/auth/confirm-route.test.ts`.
  - Pushing from a network that blocks pooler port 5432 hangs; see the troubleshooting section of `docs/deployment.md`.
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

### M4 — Friends, groups, invitations ✅
- [x] Friend requests by email; auto-friend on group join
- [x] Group CRUD (create, edit, list; types, default currency, simplify-debts), member management, admin roles. Archive/delete not in scope yet
- [x] Invite links and email invitations; acceptance page `invite/[token]`; expiry and revoke
- [x] Leave/remove only at zero balance in every currency
- [x] E2E steps 1–2 pass, plus wrong-group and revoked-token tests

### M5 — Expenses ✅
- [x] Add/edit/duplicate/cancel expense (group and direct)
- [x] All split types, multi-payer, itemized with tax/tip/discount
- [x] Live share preview with rounding indicator; server-side recomputation
- [x] Expense detail, version history (before/after), comments
- [x] Group expense list with pagination
- [x] E2E step 3 passes; edit/cancel reflected in balances

### M6 — Balances, dashboard, settlements (staging deploy pending approval)
- [x] Group and friend balances (per currency)
- [x] Dashboard: owe / owed / net, by person, groups, recent activity and settlements, quick actions
- [x] Simplify-debts toggle and suggested transfers
- [x] Settle-up flow with pending/completed/rejected/cancelled states; settle-up-everything
- [x] Settlement history
- [x] E2E steps 4–9 pass
- [ ] Staging deploy of the MVP — **needs approval**

### M7 — Recurring expenses and receipts (staging push pending approval)
- [x] Recurring templates (frequency, dates, timezone, resolved shares); pause/resume/cancel; edit applies to future occurrences only
- [x] Month-end handling; idempotent `recurring_occurrences`
- [x] `pg_cron` generator + npm script to run it manually (`npm run db:recurring`)
- [x] Receipt upload (type sniffing, 5 MB, client compression), signed URLs
- [x] Generator twice → each occurrence once; non-members denied receipts
- [ ] Push the M7 migration and branch to staging — **needs approval**

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

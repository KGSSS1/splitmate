# Independent review after M6 (M0–M6)

Six reviewers, each a fresh agent that had not seen the build or its notes, reviewed the `staging` branch at `c244efa` on 2026-10-22. Each got only the repository, `docs/SPEC.md`, its own brief and the output format, and worked against the local Supabase stack.

| Reviewer | Brief |
| --- | --- |
| A | Accounting correctness, including a differential test that compares the database with the TypeScript engine |
| B | Database and authorization security, run as an attacker with synthetic users |
| C | Application security: Server Actions, proxy, auth flows, build output |
| D | Spec conformance and product behaviour, clicking through on mobile and desktop |
| E | Test quality: mutation testing |
| F | Code quality: maintainability, accessibility and performance |

**Baseline before any change:** lint ✓, typecheck ✓, unit 400 ✓, integration 14 ✓, pgTAP 379 ✓, Playwright 30/30 ✓, build ✓.

Findings are de-duplicated and sorted by severity. IDs in brackets are the reviewers' own numbers, for example [B1] or [D-F1]. Status values:

| Status | Meaning |
| --- | --- |
| **Fixed** | A test reproduced the finding before the fix and passes after it |
| **Reproduced, needs decision** | The finding is real, but fixing it changes a SPEC rule |
| **Open** | Medium and Low findings, waiting for a decision. A recommendation is given for each |

## Summary

| Severity | Count | Fixed | Needs decision | Open | Not reproduced |
| --- | --- | --- | --- | --- | --- |
| Critical | 0 | — | — | — | — |
| High | 6 | 6 | 0 | — | 0 |
| Medium | 18 | 1 | — | 17 | — |
| Low | 41 | 1 | — | 40 | — |

Reviewer E's first pass ran on an older commit (`main`, before M4) by mistake. The second pass, on `staging` `c244efa`, is the one that counts. It ran 30 mutations; 11 still passed every suite at that commit (see [Reviewer E, second pass](#reviewer-e-second-pass)). In that pass E re-rated E1 (H6 below) as Medium, so it is listed and counted as Medium, though it was already fixed.

---

## High

### H1 · Open redirect through a dot-segment `next` value [C1] · **Fixed**
- **Where:** `src/lib/auth/routes.ts`, `safeNextPath`. It is used by the login action, the onboarding action and the onboarding page.
- **What was wrong:**
  - The guard rejected `//host` and `\`, but not `/.//host`, which normalises to the path `//host`.
  - Next's client router then navigates to that pathname, which the browser treats as a protocol-relative URL on another origin.
  - Logging in with `/login?next=%2F.%2F%2Fevil.example` landed on the attacker's site. An onboarded user who opened `/onboarding?next=…` was sent there with no interaction at all.
- **Reproduced by:**
  - 7 new cases in `tests/unit/auth/routes.test.ts`: `/.//x`, `/..//x`, `/invite/..//..//x`, `/./%2F/x`, `/%2e//x`, `/dashboard/..//x?x=1` and `/groups//x`.
  - The E2E test "a dot-segment `next` can't send a signed-in user to another site" in `tests/e2e/auth.spec.ts`. Against the old code the browser left the site and ended on `chrome-error://`.
- **Fix:** the path is percent-decoded, and any `.` or `..` segment, `//` or `\` sends the user to the dashboard instead.

### H2 · A removed member could rejoin through someone else's invite link [B1] · **Fixed**
- **Where:** `public.accept_invitation`.
- **What was wrong:**
  - Removal revoked only the removed member's own links, so an admin's multi-use link created earlier still let them back in.
  - Rejoining also cleared `removed_by`, which erased the removal from the record.
  - This breaks SPEC §8: "Removed members cannot perform any future action."
- **Reproduced by:** `supabase/tests/130_review_m6.test.sql`, tests 1–7.
- **Fix** (migration `20261022060000_review_m6_fixes.sql`):
  - `accept_invitation` refuses a removed member (SM403) for any invitation created before the removal.
  - An invitation created after the removal still works as a deliberate re-invite.
  - A member who left on their own can still rejoin.

### H3 · Simplified groups contradict friend balances, dashboard totals and "Settle up everything" [D-F1] · **Fixed (option 1, decided 2026-10-22)**
- **Where:**
  - `friend_balances` and `friend_group_balances`, which take raw pairwise balances.
  - `settle_up_with_friend`.
  - The dashboard's "You owe / You are owed" and "Balances by person".
  - The friend page.
- **What is wrong:** with simplify-debts on, the group's suggestions come from members' net balances, but everything at friend level uses the raw pairwise rows (SPEC §7: "Show friend balances from raw pairwise entries").
  - After everyone follows the simplified plan, the group shows "settled up", but a pairwise cycle remains (for example A→B, B→C, C→A ₹100 each).
  - The dashboard shows "You owe ₹100 / You are owed ₹100", and the friend page offers to settle it.
  - Using "Settle up everything" then makes the settled group unbalanced again, for money nobody owes.
- **Reproduced by:** `tests/integration/simplified-friend-balances.test.ts`. The two `it.fails` cases pass while the behaviour exists and will flip when it's fixed.
- **Decision:** option 1, chosen by the product owner. SPEC §2, §7, §9 and §11 are updated.
- **Fix** (migration `20261022120000_simplified_friend_view.sql`, `src/lib/settlements/friend-view.ts`, `src/server/balances.ts`):
  - For groups that simplify, friend balances, dashboard totals, "Balances by person", the friend page breakdown (labelled "simplified") and "Settle up everything" use the transfer between the two people in the group's simplified plan.
  - Direct expenses and non-simplifying groups keep raw pairwise balances.
  - The server computes "Settle up everything" amounts. The database checks them:
    - raw contexts must match exactly;
    - simplified groups need the right direction and no more than either member's net.
  - The checks validate the plan without re-implementing it.
- **Tests:**
  - `tests/integration/simplified-friend-balances.test.ts` is now four normal tests. Before settling, every view matches the plan; afterwards nobody's view shows anything owed; the raw leftover can't be settled.
  - Unit `tests/unit/settlements/friend-view.test.ts`, including a property test that the viewer's rows add up to their net.
  - pgTAP `120_balances_settle_up`: validation cases and a group where the plan differs from raw.
  - E2E "friend balances follow the group's simplified plan".
  - Reviewer A's differential test now expects the engine's plan for groups.
- **Options that were considered:**
  1. **(Recommended)** For simplify-on groups, derive the friend-level view and "Settle up everything" from the group's simplified transfers between the two people, not from raw pairwise rows. Dashboard owe/owed totals for those groups would come from the group nets.
  2. Leave simplify-on groups out of "Settle up everything" and link to each group's own suggestions instead. Friend balances would show the group net between the two with a "settle in the group" note.
  3. When a settlement between two people with no direct debt is recorded under simplification, also write offsetting pairwise rows along the debt chain, so raw pairwise balances stay consistent. This is more complex and changes ledger semantics.

### H4 · The activity feed checked visibility for every event in the system [F1] · **Fixed**
- **Where:** `src/server/activity.ts`, which runs on every dashboard load and on `/activity`.
- **What was wrong:**
  - The query filtered `audit_events` only by type and left visibility to RLS.
  - Postgres therefore ran `is_group_member` / `can_view_expense` / `can_view_settlement` on every expense and settlement event of every user, then sorted.
  - The exact count repeated the scan, so cost grew with total system activity.
- **Reproduced by:** `130_review_m6.test.sql` counts calls to the visibility helpers with `track_functions`. A plain RLS select of 25 rows ran them at least 1,500 times when 1,500 unrelated events existed.
- **Fix:**
  - New `public.my_activity(limit, offset)` (SECURITY INVOKER) collects candidates from the caller's groups, own actions, own settlements and own expenses through indexed joins. RLS still decides visibility.
  - On the same data it runs the helpers fewer than 100 times.
  - It returns exactly the rows RLS allows (a `set_eq` against the plain select), plus `total_count`.
  - The index `audit_events_actor_id_idx` was replaced by `(actor_id, created_at)`.
  - `listActivity` now calls `my_activity`.

### H5 · Group balances were loaded one RPC per group [F2] · **Fixed**
- **Where:** `src/server/groups.ts`, `listMyGroups`, used by the dashboard, `/groups` and `/settle-up`.
- **What was wrong:** each group called `group_balances` for all members, only to keep the caller's own row: N+3 round trips per render.
- **Reproduced by:** `tests/unit/server/groups.test.ts`. With 3 groups there were 3 RPC calls where 1 was expected.
- **Fix:** one call to `my_group_balances()`, filtered to current groups.

### H6 → Medium · No test checked that a rejected settlement leaves the ledger alone [E1] · **Fixed**
_Reviewer E rated this High in its first pass and Medium in its second, because by its analysis the E2E reject flow would catch it. It is counted as Medium._
- **Where:** `supabase/tests/040_settlements.test.sql`.
- **What was wrong:** a mutation that wrote a ledger charge on reject still passed every pgTAP test. SPEC §11 says only completed settlements affect balances.
- **Fix:** after the rejection, the test now checks that the settlement has no ledger rows and that the balances are unchanged.
- **Verified:** under the mutation, tests 26 and 27 fail; against the real code, all 35 pass.

### H7 · RLS tests missed former members' settlement visibility and three tables [E2] · **Fixed**
- **Where:** `supabase/tests/020_rls.test.sql`.
- **What was wrong:**
  - Two policy mutations passed every test:
    - `settlements_select` widened to former members;
    - `using (true)` on `expense_items`, `expense_item_assignments` and `recurring_occurrences`.
  - The fixture had no rows that could expose either one.
- **Fix:**
  - The fixture gains itemized lines (group and direct), item assignments, a recurring occurrence, and a settlement between others after the removal.
  - New per-actor counts for those tables.
  - A generic check that every exposed `public` table is empty for an outsider except their own profile. New tables are covered automatically.
- **Verified:** mutation 4b fails test 29. Mutation 4d fails 8 tests, including the generic one.

---

## Medium (open, awaiting your decision)

| ID | Finding | Where | Reproduce | Recommendation |
| --- | --- | --- | --- | --- |
| M1 | **Leave vs edit/cancel race** [B2, A1]. While a cancel or edit is in flight, the affected member can leave at zero balance. When the change commits, a former member has a balance that nobody can settle. | `20261021130700_rpc_expenses.sql` (`lock_expense_for_change`, `cancel_expense`, `update_expense`); `end_membership` | `scratchpad/review/A/run-leave-race.sh`, `review/B/07_cancel_vs_leave_race.mjs` | **Fix next.** Lock the `group_members` rows of the old ∪ new version's users `FOR SHARE` in `lock_expense_for_change`, ordered by user ID. |
| M2 | **Balance sums can pass 2^53** [B3, A4]. Each amount is capped, but sums are not. Two maximum-size expenses push a victim's balance past `Number.MAX_SAFE_INTEGER`, and their dashboard throws. | balance functions; `src/server/balances.ts` | `review/B/02_expense_rpc_tampering.mjs`, `review/A/balance-overflow.cjs` | **Fix.** Reject writes that would push a pairwise or net balance past ±(2^53−1) (SM422). Also consider a realistic per-currency maximum amount. |
| M3 | **The DB accepts split details that contradict the shares** [C2, B4]. An "equal" split of 1/999, "50%" while charging 99.9%, item assignments not matching. Debts can't be rerouted, but the records mislead. | `private.write_expense_version` | `review/C/t10.mjs`, `review/B/02_…` | **Fix.** Add invariant checks: equal shares differ by at most 1 unit; percentage and shares within 1 unit of the exact share; item totals reconcile. These validate the result; they don't re-split. |
| M4 | **History is incomplete** [D-F2]. Notes, tags and itemized lines are not in the snapshot, so edits to them show an empty "edited it". Saving with no changes creates a new version. | `private.expense_snapshot`; `src/lib/expenses/history.ts` | Edit only notes or tags | **Fix.** Add the fields to the snapshot and the diff, and skip no-op updates. |
| M5 | **"You owe ₹X" on expense rows and activity reads like a current balance** and stays after settling up [D-F3]. | `expense-list.tsx`, `src/lib/activity/describe.ts` | Settle fully, then look at the group's expenses | **Fix** (wording): "Your share ₹X · you paid ₹Y", or "You borrowed ₹X", in a neutral tone. |
| M6 | **Direct expenses with a friend can silently disappear** [F3]. Only the latest 100 direct expenses with anyone are loaded, then filtered to the friend. The query also scans every direct expense in the table under RLS. | `src/server/expenses.ts` `listDirectExpenses` | `review/F/explain1.sql` | **Fix.** Query from that friend's participant rows and paginate. |
| M7 | **The keyboard focus of list rows is invisible** [F4]: a 1.04:1 tint only. | `expense-list`, `activity-list`, `settlement-list`, friends and groups list rows | `review/F/focus.cjs` | **Fix.** Use a shared row-link class with an inset focus ring. |
| M8 | **Light-theme contrast below AA** [F5]: tinted badges and chips 4.33:1, destructive buttons 4.02:1, muted chips 4.34:1. | `button.tsx`, `settlement-status-badge.tsx`, theme picker, split chips | `review/F/axe.cjs` | **Fix** with darker foreground tokens for tinted surfaces, then rerun axe. |
| M9 | **Timestamps use the server's time zone** [F6]. On Vercel (UTC), IST users see times 5h30 off. | activity list, settlement detail, members and friend pages | `TZ=UTC` comparison | **Fix.** Add one `formatTimestamp(iso, profile.timezone)` helper. |
| M10 | **The TS balance, ledger and lifecycle model is unused in production** and duplicates SQL [F7, E10]. | `src/lib/accounting/balances.ts`, `ledger.ts`, `src/lib/settlements/lifecycle.ts` | grep | **Keep as a test oracle.** The new `tests/integration/differential-review.test.ts` (from reviewer A) now checks it against the DB. Document it as a reference model. |
| M11 | **Touch targets under 44 px** on mobile [F8, D-F9]: menu trigger 36 px, dashboard "All …" links 20 px, theme picker 36 px, settings buttons 40 px, "Notes and tags" 32 px. | `mobile-menu.tsx`, `dashboard/page.tsx`, `theme-picker.tsx`, `expense-form.tsx` | `review/F/focus.cjs` | **Fix** with `min-h-11` / `size-11` on phones. |
| M12 | **Per-creator idempotency scope is untested** [E3]. A lookup that ignored the creator would hand another user's expense, or batch, back. | `030_expenses`, `040_settlements`, `120_balances_settle_up` tests; integration `settlements.test.ts` | mutations 5a, S2 | **Fix.** Add cross-user same-key tests for `create_expense`, `create_settlement` and `settle_up_with_friend`. |
| M13 | **Server modules have no unit tests** [E4]: `src/server/auth.ts` (deleted-account redirect), `src/server/balances.ts`, `src/server/actions/*`. The onboarding redirect is now caught by E2E `default-email-links.spec.ts` (mutation 6b fails). | `src/server/*` | mutation 6b (partly) | **Fix.** Add unit tests with mocked clients, in the style of the new `tests/unit/server/groups.test.ts`. |
| M14 | **The server's simplify toggle is untested** [E-N1]. If `getGroupSuggestions` ignores the toggle, every suite still passes: the E2E toggle-off step uses two people, where both plans are identical, and the integration test calls `suggestedTransfers` itself. | `src/server/balances.ts`; `settlements.spec.ts`; integration `settlements.test.ts` | mutation T2 | **Fix.** Use a 3-person group where simplified and raw differ, and assert the raw rows with the toggle off. |
| M15 | **The settle-up direction → payer/receiver mapping** is only tested by E2E [E-N2]. | `src/server/actions/settlements.ts:33-34` | mutation T3 | **Fix.** Unit test with mocks: "paid" and "received" mapping, and self as the other person refused without an RPC call. |
| M16 | **Pairwise netting has no fixture with debts both ways** [E-N3]. | `120_balances_settle_up.test.sql` | mutation S5 | **Fix.** Add a Bob-pays expense with Alice in Flat and assert the netted row. |
| M17 | **Flaky component tests** [E-N6, F15]. A second Save/retry click can land on a still-disabled button: `expense-form.test.tsx:169-171` failed 3 of 8 runs, `settle-up-form.test.tsx` failed once. Root cause: the action result renders while `pending` is still true. | `use-action-submit.ts`, the two tests | repeated `npm test` runs | **Fix.** Wait for the button to be enabled before retrying; set the result after the transition. |

## Low (open, awaiting your decision)

| ID | Finding | Where | Recommendation |
| --- | --- | --- | --- |
| L1 | Two parallel "Settle up everything" calls with the same key: one returns IDs, the others SM422 [A2] | `settle_up_with_friend` | **Addressed by the H3 rewrite:** the batch lookup is repeated after the friendship lock. Not separately tested. |
| L2 | Repeated "Settle up everything" by the debtor creates duplicate pending settlements; confirming both overpays [A3] | `settle_up_with_friend` | Fix together with H3: subtract or refuse open pending settlements |
| L3 | Duplicate people in the form payload make the Server Action throw instead of returning a validation error [A5] | `src/lib/validation/expenses.ts`, `resolve.ts` | Fix: unique-userId refine |
| L4 | TS lifecycle and SQL return different refusal codes (SM409 vs SM403) for three invalid transitions [A6] | `lifecycle.ts` vs `rpc_settlements.sql` | Document; align if lifecycle stays |
| L5 | `attachments` rows can be forged or squatted for others' objects [B5] | `attachments_insert` policy | Fix in M7 (receipts): require an owned `storage.objects` row |
| L6 | Receipt type isn't validated by content [B6] | receipts bucket | M7: magic-byte check in the upload route |
| L7 | A pending friend request reveals the target's name through `profile_cards` [B7] | `private.shares_context_with` | Fix: count pending rows only for the recipient |
| L8 | A friend request says whether an email has an account [D-F11] | `src/lib/friends/request-outcome.ts` | Decide: neutral reply vs current UX (SPEC §8 privacy) |
| L9 | Former members read the group's live name and settings [B8] | `groups_select_members` | Fix: `is_group_member`, plus a name snapshot for history |
| L10 | Admins can update `groups` directly through the API, bypassing audit and validation [B9] | `groups` UPDATE grant | Fix: revoke; go through `update_group` |
| L11 | Every member can see invitees' email addresses, and they are kept in audit [B10] | `group_invitations` | Fix: limit to the creator and admins; mask in audit |
| L12 | The access token keeps working for up to 1 h after logout [C3] | `getClaims()` | Use `getUser()` for sensitive actions; document the window |
| L13 | The auth cookie isn't HttpOnly or Secure, though no browser client reads it [C4] | `src/lib/supabase/*.ts` | Fix: `cookieOptions` |
| L14 | No security headers (clickjacking possible); `X-Powered-By` is sent [C5] | `next.config.ts` | Fix: `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`; `poweredByHeader: false` |
| L15 | No group-level activity view [D-F4] | group tabs | Add when doing M8 activity |
| L16 | A former member sees "Add the first expense" [D-F5] | group page | Fix copy |
| L17 | The `?saved=` banner stays after a later action on the same page [D-F6] | settlement and expense pages | Fix |
| L18 | The confirm dialog's dismiss button says "Cancel" next to "Cancel expense" [D-F7] | `action-button.tsx` | Rename to "Keep it" |
| L19 | Split-method pills and the active nav tab use colour only [D-F8] | `expense-form.tsx`, `app-nav.tsx` | Add a check icon or indicator bar |
| L20 | Non-admins are told to "turn on Simplify debts in Settings" [D-F10] | balances page | Fix copy |
| L21 | Itemized weights have no UI [D-F12] | `expense-form.tsx` | Defer (engine supports it) |
| L22 | The preview amounts have no visible "share" label; ambiguous with multiple payers [D-F13] | `split-preview.tsx` | Fix |
| L23 | Pending or rejected records are headlined "X paid you ₹…" [D-F14] | `settlement-list.tsx` | Fix: "X says they paid you" / "(rejected)" |
| L24 | "Proportionally" is truncated at 375 px [D-F15] | `expense-form.tsx` | Fix |
| L25 | Extra round trips: `friend_balances` twice on the dashboard, a full page of settlements to show 5, `group_balances` twice, sequential awaits, all versions fetched [F9] | various `src/server` | Fix gradually with `cache()` and `Promise.all` |
| L26 | Unchecked `error` in `changePermission`; `signOut` result ignored [F10] | `expenses.ts`, `auth.ts` | Fix |
| L27 | Confirm-button focus drops to `<body>` [F11] | `action-button.tsx` | Fix |
| L28 | The whole preview is `aria-live`, so every keystroke re-announces all of it [F12] | `split-preview.tsx` | Fix: one-line live summary |
| L29 | Nested `<main>` on not-found pages inside the app [F13] | `src/app/not-found.tsx` | Fix |
| L30 | Dead and duplicated code (status labels, page schemas, textarea classes, `NETWORK_ERROR`, nav "Soon" branches, unused exports) [F14] | various | Clean up |
| L32 | Amount placeholders are hard-coded to "0.00" (wrong for JPY and KWD) [F16] | `expense-form.tsx` | Fix |
| L33 | Route-access tests have no near-miss for the public `/auth/` prefix [E5] | `tests/unit/auth/routes.test.ts` | Fix |
| L34 | `throws_ok(…, 'SM422', null)` accepts any SM422, so it can't tell which guard fired [E6] | pgTAP 030/040/090 | Fix: assert the messages |
| L35 | The "sums to zero" checks are tautological for a pairwise ledger [E7] | `080_balances`, `properties.test.ts` | Keep as smoke checks; per-person nets already covered |
| L36 | The idempotency unit test only tests determinism [E8] | `idempotency.test.ts` | Rename |
| L37 | Constraint tests assert "any error" instead of `23514` [E9] | `auth-profile.test.ts` | Fix |
| L38 | `upi://pay` deep link not implemented [D] | — | Optional in SPEC §11; skip |
| L39 | Withdrawn pending settlements are stored as `cancelled`, with "reversed" wording [D, spec note] | settlements | Decide with the SPEC change below |
| L40 | `transfersInvolving` is never tested from the receiver's side [E-N4] | `suggestions.test.ts` | Fix: assert the incoming transfers |
| L41 | No test for a cancelled *pending* settlement's activity wording (it must not say "reversed") [E-N5] | `describe.test.ts` | Fix |
| L42 | Property tests run without a fixed seed, so detection varies between runs [E-N7] | `properties.test.ts` | Fix: `fc.configureGlobal({ seed })`, or log the seed |

---

## Spec changes the reviewers suggest

1. **Friend balances under simplification (§2, §7, §11).** See H3. Specify how simplify-on groups appear in friend balances, dashboard totals and "Settle up everything".
2. **History scope (§10).** "Full version history" should name what it covers (notes, tags, items and allocations) and say that saving without changes doesn't create a version.
3. **Email lookup privacy (§2, §8).** Friend-request responses must not reveal whether an email is registered (L8).
4. **Touch targets.** Move "at least 44 px" from §16 (PWA, M9) to §9: it governs every layout from M3 on.
5. **Withdrawn payments (§11).** Consider a separate `withdrawn` status, or distinct wording, for a pending settlement withdrawn by its payer.

## Done well (all reviewers)

- **Accounting** [A]:
  - No mismatch between the database and the TypeScript engine across 4,800+ random operations. They covered every split method, multiple payers, 4 currencies with exponents 0/2/3, edits, cancels, retries and settlements in every state.
  - Concurrency tests passed: duplicate creates, competing edits, cancel vs edit, double confirms and cancels.
  - Rounding is deterministic and fuzzed (30k pairwise and 19k itemized cases).
- **Database security** [B]:
  - An outsider sees nothing in any table or balance function.
  - The ledger and audit log are append-only for every role.
  - Debts can't be rerouted, and token misuse is refused in every variant tried.
  - Settlement role rules hold, and storage is denied to outsiders.
  - `private` isn't exposed, every DEFINER function pins `search_path`, and lint and advisors are clean.
- **Application security** [C]:
  - All 31 Server Actions validate with Zod and re-check identity with `getClaims()`.
  - The client bundle has no secrets or source maps.
  - Tampered and `alg: none` cookies are rejected, Server Action CSRF is blocked, and there are no SQL or stack leaks.
  - Sign-up and reset don't allow account enumeration.
- **Product** [D]:
  - Every balance checked by hand matched.
  - Statuses are always words, balances are worded relative to the viewer and kept per currency, and "simplified" is labelled.
  - Outsiders get uniform 404s, and the mobile layout has no overflow.
- **Tests** [E]:
  - Every TypeScript accounting mutation was caught, several by multiple tests.
  - The pgTAP expense and settlement files check real balances against the SPEC numbers.
  - RLS is tested per actor.
- **Code** [F]:
  - There is no second copy of split math: SQL validates and sums only.
  - Money is integers end to end with no `parseFloat`.
  - Indexes cover almost every filter, and every route has loading and error states.

## Reviewer E, second pass

Run on `staging` `c244efa`, before the fixes above. Baselines: unit 400, integration 14, pgTAP 376 (+3 helper/smoke), Playwright 30/30. SQL mutations ran inside each pgTAP file's own transaction and were rolled back; the shared DB was checked clean afterwards.

**Results at `c244efa`:** 19 of 30 mutations were caught, and 11 still passed every suite.

| Still passed at `c244efa` | Status now |
| --- | --- |
| 3b reject writes the ledger | **Caught**: `040` tests 26–27 (H6) |
| 4b former members see others' settlements | **Caught**: `020` test 29 (H7) |
| 4d item, assignment and occurrence policies opened | **Caught**: `020` tests 1–4, 30–32, 46 (H7) |
| 5a, S2 idempotency key not scoped to its creator | Open: M12 |
| 6a `/auth` prefix widened | Open: L33 |
| 7 outsider ledger check disabled | Open: L34 |
| S5 pairwise not netted | Open: M16 (integration catches it by analysis) |
| T2 server ignores the simplify toggle | Open: M14 |
| T5 cancelled pending described as reversed | Open: L41 |
| T7 receiver-side suggestions | Open: L40 |

**Caught at `c244efa`:**
- **Rounding** (1a, 1b, 1c).
- **Reversals** (2a, 2b).
- **Settlement ledger rules:**
  - pending (3a);
  - withdraw (3c);
  - TS, only completed settlements write entries (3d).
- **Former-member RLS** (4a, 4c).
- **Idempotent retry** (5b).
- **Onboarding redirect** (6b).
- **Settle up everything:**
  - skipping groups someone left (S1);
  - one derived key per group and currency (S3).
- **`my_group_balances`** leaves out direct rows (S4).
- **Toggle in the pure function** (T1).
- **Direction mapping** (T3), caught by E2E only.
- **Activity wording** (T4, T6).

## Artifacts

- The reviewers' scripts and outputs are outside the repo, in the session scratchpad (`review/A` … `review/F`). The commands to rerun each one are in the finding text above.
- Kept in the repo:
  - `tests/integration/differential-review.test.ts` (reviewer A; seed via `DIFF_SEED`);
  - `tests/integration/simplified-friend-balances.test.ts` (H3);
  - `tests/unit/server/groups.test.ts` (H5);
  - `supabase/tests/130_review_m6.test.sql` (H2, H4);
  - the new cases in `routes.test.ts`, `auth.spec.ts`, `040_settlements` and `020_rls` (H1, H6, H7).

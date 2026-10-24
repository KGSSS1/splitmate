# Architecture: money and accounting engine

(Authentication and the app shell are covered at the end.)

This document records the accounting rules implemented in M1. The code is pure TypeScript with no I/O:

| Module | Responsibility |
| --- | --- |
| `src/lib/money` | Currency table, amount guards, parsing, formatting |
| `src/lib/accounting` | Splits, rounding, itemized bills, pairwise debts, ledger entries, balances, idempotency keys |
| `src/lib/settlements` | Debt simplification, settlement lifecycle |

The TypeScript accounting module is the **only** implementation of split and pairwise-allocation logic (SPEC §6). Server Actions run it on the server; the database functions (M2) only validate its output.

## Money representation

- Every amount is an integer number of **minor units** of its currency. The exponent comes from ISO 4217 via `CURRENCIES` in `src/lib/money/currencies.ts` (INR/USD/EUR/GBP 2, JPY/KRW/VND 0, KWD/BHD/OMR/JOD/TND 3). Code never assumes 2 decimals.
- Amounts are JavaScript `number`s restricted to safe integers (`Number.isSafeInteger`). They are not JS `bigint`, because `bigint` cannot be JSON-serialized or passed from Server to Client Components.
- **Maximum amount:** `MAX_MINOR_AMOUNT = Number.MAX_SAFE_INTEGER = 9,007,199,254,740,991` minor units is the technical ceiling. For INR that is ₹9,00,71,99,25,47,409.91; Postgres `bigint` (max ≈ 9.2 × 10¹⁸) holds it comfortably.
- **Per-currency expense limit (SPEC §7):** one expense may not exceed `maxExpense` in `src/lib/money/currencies.ts`, about US$100,000 rounded per currency (INR ₹1,00,00,000, JPY ¥15,000,000, KWD 50,000). The form checks it (`resolveExpense`), the database enforces it, and `currency-sync.test.ts` keeps the tables equal. A ledger trigger keeps each person's sum of absolute pairwise balances per currency within 2^53 − 1, so every balance the app shows stays exact.
- Intermediate products (amount × basis points, amount × weight, itemized fractions) can exceed 2⁵³, so the rounding code uses `bigint` **internally** and converts back to `number` only after the result is known to be safe. Balance sums are accumulated in `bigint` and range-checked once per final balance, so the result never depends on entry order; an out-of-range balance throws `OVERFLOW` rather than losing precision.
- Floating point is never used for money:
  - `parseMoney("1,23,456.78", "INR")` parses with string and `bigint` arithmetic only. It accepts plain digits, Indian grouping (`12,34,567`) or international grouping (`1,234,567`), but not a mix of the two (`1,234,56,789` is rejected). Extra decimals are rejected (`TOO_MANY_DECIMALS`) unless they are trailing zeros. Signs, symbols and exponents are rejected.
  - `formatMoney` passes an exact decimal string to `Intl.NumberFormat`. The default locale is `en-IN`.
- Percentages are integer **basis points** (10,000 = 100%). Weighted shares are positive integers.

## Sign convention

Positive balance = others owe this person. Negative balance = this person owes. The same convention applies in code, the database, the UI and tests.

## Rounding: largest remainder method

`roundShares(exact, denominator, total)` in `src/lib/accounting/rounding.ts` is the single rounding primitive:

1. Each participant's exact share is `numerator / denominator`, and the numerators sum to `total × denominator`.
2. Everyone gets the floor.
3. The leftover minor units (always fewer than the number of participants) go one at a time to the largest fractional remainders.
4. Ties go to the earlier participant in entry order; user ID is the final fallback.

The output keeps input order. Each share carries `roundingUnit: 0 | 1` so the UI can show who received a rounding unit. Zero-weight (excluded) participants never receive one.

Examples: ₹100 ÷ 3 → 3334 / 3333 / 3333 paise. ¥100 ÷ 3 → 34 / 33 / 33.

Split methods (`src/lib/accounting/splits.ts`):

| Method | Input | Rule |
| --- | --- | --- |
| `equal` | user IDs | weight 1 each; unlisted members owe nothing |
| `exact` | amount per user | must sum to the total; 0 allowed; no rounding |
| `percentage` | basis points per user | integers 0–10,000 summing to exactly 10,000; 0 bps = excluded |
| `shares` | positive integer weight per user | proportional |

## Itemized bills, tax, tip, service charge, discounts

`splitItemized` in `src/lib/accounting/itemized.ts` keeps everything as exact fractions over one common denominator and rounds **once**, at the end:

1. Each item is split among its assignees by weight (default 1 = equal). Summing over items gives each person's exact pre-tax subtotal `sᵢ`. The items total is `S = Σ sᵢ`.
2. Tax, service charge and tip each add `A × sᵢ / S` (proportional, the default) or `A / n` (the `equal` override, split among everyone on the bill).
3. Discounts subtract the same way. Total discounts may not exceed `S`. If an equal discount would make anyone's share negative, the split is rejected (`NEGATIVE_SHARE`).
4. The bill total is `S + charges − discounts`. The exact shares are rounded with the largest remainder method, so the final shares sum to the bill total exactly.

Rounding only once avoids the drift that per-item or per-charge rounding would add up.

## Multi-payer expenses and pairwise debts

The ledger is **pairwise** (SPEC §6). `allocatePairwise(payers, shares)` in `src/lib/accounting/pairwise.ts`:

1. `netᵢ = paidᵢ − shareᵢ`. Creditors have net > 0; debtors have net < 0.
2. Each debtor's debt is allocated to the creditors in proportion to each creditor's excess payment: `|net_d| × net_c / Σ creditor nets`.
3. The whole debtor × creditor matrix is rounded together, not row by row. Rounding each row on its own can overpay a creditor (two debtors each owing 1 unit to two equal creditors would both pay the first). The steps:
   - Every cell gets its floor.
   - Leftover units go to cells with the largest remainders (ties: debtor order, then creditor order), as long as both that debtor and that creditor still need a unit.
   - Any unit the greedy pass cannot place is routed along a deterministic augmenting path. An integral solution always exists, because the fractional matrix is itself a feasible flow.

   The result: every debtor pays exactly their net debt, every creditor receives exactly their excess, and each cell is within one unit of its exact value.
4. A single-payer expense never needs rounding: everyone simply owes the payer their share.

Example (SPEC §7): A pays ₹600 and B pays ₹300 for a ₹900 bill split equally among A, B and C. Nets are A +300, B 0, C −300, so the only entry is C → A ₹300.

## Ledger entries, edits and cancellations

`src/lib/accounting/ledger.ts` produces append-only `LedgerEntry` rows:

```
{ debtorId, creditorId, amount > 0, currency, groupId | null,
  source: { kind: "expense" | "settlement", id, version }, entryType: "charge" | "reversal" }
```

- **Expense:** `buildExpenseEntries(input)` takes one stored version of an expense: `{ expenseId, version, groupId, currency, total, payers, shares }`. It checks that the payers and the shares each add up to `total` (a positive safe integer), then writes charge entries from `allocatePairwise`, linked to the expense and its version.
- **Edit:** `amendExpenseEntries(current, next)` takes the current *version input*, not a list of ledger rows. It rebuilds that version's charges and reverses them all, then adds charges for `next`, which must be the same expense at version `current.version + 1`. Because the reversals are derived from the stored version, they are always complete and always in that version's currency and group. A reversal swaps debtor and creditor, so amounts stay positive.
- **Cancel:** `cancelExpenseEntries(current)` returns reversals of every charge of the current version, and nothing else.
- Every function that reads ledger rows (`reverseEntries`, the balance functions) rejects malformed rows: a non-positive or non-integer amount, an unknown currency, or a debtor equal to the creditor.
- **Settlement:** one entry only when `completed`. Its direction is opposite to the debt (`debtorId = receiver`, `creditorId = payer`), so the payer's debt decreases. Pending, rejected and cancelled settlements have no entries. Cancelling a completed settlement writes its reversal.

## Balances

`src/lib/accounting/balances.ts` derives every balance from the ledger. Nothing is stored as a running total.

| Function | Result |
| --- | --- |
| `netBalances(entries)` | per user and currency |
| `groupBalances(entries, groupId)` | one group; `null` = direct expenses |
| `pairBalances(entries, userId)` | friend view: raw pairwise totals with each counterparty across all groups and direct expenses, per currency |
| `pairBalance(entries, a, b)` | one pair, per currency |

Currencies are never mixed, and unknown currency codes are rejected (also in `simplifyDebts`). Zero balances are omitted. Output is sorted, so it is deterministic. Within any group, balances sum to zero per currency; property tests check this.

## Debt simplification

`simplifyDebts(balances)` in `src/lib/settlements/simplify.ts` is a deterministic greedy algorithm:

1. Group by currency. Reject input whose currency doesn't sum to zero.
2. Repeatedly match the largest creditor with the largest debtor (ties by user ID) and transfer the smaller of the two amounts.

Each step clears at least one person, so it produces at most n − 1 transfers for n non-zero members, and every net balance is preserved exactly. Finding the true minimum number of transfers is NP-hard, so the UI calls the result **"simplified"**, never "optimal". Friend-level views follow the same plan: see [Friend balances and simplified groups](#friend-balances-and-simplified-groups).

`suggestedTransfers({ simplify, nets, pairwise })` in `src/lib/settlements/suggestions.ts` picks the source for a group's Balances tab: simplified from `group_balances` when the toggle is on, the raw `group_pairwise_balances` rows when it is off. Both are sorted by currency, then largest amount, then user IDs. Only transfers involving the viewer get a "Record payment" / "Record as received" link, because only the payer or the receiver can record a settlement.

A settlement between two members who never owed each other directly (possible with simplification) is still one pairwise ledger row, so group nets stay correct.

### Friend balances and simplified groups

`friendContextBalances` (`src/lib/settlements/friend-view.ts`) gives the viewer's balance with each person per context and currency (SPEC §2, §7, review M6 H3):

| Context | Amount |
| --- | --- |
| Direct expenses | Raw pairwise balance (`my_pairwise_balances`) |
| Group with simplify-debts **off** | Raw pairwise balance |
| Group with simplify-debts **on** | The transfer between the two in `simplifyDebts(members' nets)` (`my_simplified_group_balances`); raw rows are ignored |

Why: once everyone follows a simplified plan, the group nets are zero but raw pairwise rows can be left over (for example a cycle A→B→C→A). With raw rows, dashboards and friend pages would still show those as owed, and "settle up everything" would unbalance the settled group. Following the plan, the friend view, dashboard totals and the group's own suggestions always agree.

`src/server/balances.ts` (`loadContextBalances`, memoized per request as `getMyContextBalances`) loads both inputs in two calls and feeds the dashboard totals, "Balances by person", the friends list, the friend page breakdown (labelled "simplified") and "settle up everything". Groups the viewer has left drop out: their net there is zero. The raw functions (`friend_balances`, `friend_group_balances`) stay as ledger views for tests and checks.

## Settlement lifecycle

`src/lib/settlements/lifecycle.ts` (SPEC §2, §11):

| From | Action | Who | To | Ledger |
| --- | --- | --- | --- | --- |
| (new) | record | receiver | completed | apply |
| (new) | record | payer | pending | none |
| pending | confirm | receiver | completed | apply |
| pending | reject | receiver | rejected | none |
| pending | cancel | payer (withdraw) | cancelled | none |
| completed | cancel | either | cancelled | reverse |

Rejected and cancelled are final. Completing twice is an invalid transition, so a settlement is never counted twice. The database (M2) enforces the same rules, plus idempotency-key uniqueness.

`availableSettlementActions(settlement, viewer)` derives the buttons to show from the same table. Former members of a settlement's group get no buttons (the database refuses them too).

**Settle up everything:**
- The Server Action computes the items from `friendContextBalances`, for direct balances and groups both people are still in, so groups that simplify use the plan. It sends them to `settle_up_with_friend(key, friend_id, items)`.
- Under the friendship lock, the database checks each item:
  - direct, or a group that doesn't simplify: exactly the raw pairwise balance;
  - a group that simplifies: the right direction, and no more than either member's net. This validates the plan without re-implementing it.
  - Anything stale is refused with SM409, "Balances have changed. Reload and try again".
- Each item becomes one settlement through `private.record_settlement`:
  - the friend owes → the caller is the receiver → completed;
  - the caller owes → pending until the friend confirms.
- The batch key becomes `batch_id`; each settlement's own key is derived from it, so retries and concurrent double submits return the same IDs.
- Pending settlements don't reduce balances, so the friend page warns when some are already waiting.

## Idempotency

`createIdempotencyKey()` generates a UUID v4 on the client. Retries reuse the same key, and the database's unique constraint (per creator) turns a duplicate submission into a no-op. Ledger construction is deterministic, so a retried request always produces identical rows.

# Authentication and app shell (M3)

| Piece | Where | Notes |
| --- | --- | --- |
| Session refresh + route redirects | `src/proxy.ts` → `src/lib/supabase/proxy.ts` | Calls `getClaims()` on every page request, writes refreshed cookies and no-store cache headers to the response (also on redirects). Signed-out visitors to protected pages go to `/login?next=…`; signed-in visitors to guest pages go to `/dashboard`. |
| Route access rules | `src/lib/auth/routes.ts` | Everything not listed as guest (`/`, `/login`, `/signup`, `/check-email`, `/reset-password`) or public (`/auth/*`) is protected. `safeNextPath` only allows same-origin protected paths after login. |
| Server identity | `src/server/auth.ts` | `getClaims()` (JWT verified), memoized per request. Pages, Server Actions and route handlers call `requireUser()` themselves; the proxy redirect is a convenience, not the check. |
| Supabase clients | `src/lib/supabase/server.ts` | Publishable key + cookies, so RLS applies. No browser or secret-key client yet: none is needed until realtime (M8) and account deletion (M9). |
| Email links | `src/app/auth/confirm/route.ts` | Accepts two link styles:<br>• Custom templates (`supabase/templates/*.html`, used locally): `?token_hash=` verified with `verifyOtp`; works in any browser.<br>• Supabase's default `{{ .ConfirmationURL }}` (hosted, until custom SMTP): `?code=` exchanged with `exchangeCodeForSession`. This needs the PKCE verifier cookie from the browser that started the flow; any other browser lands on `/login?error=browser`.<br>Confirmation → `/onboarding`; recovery → `/reset-password/update` (for codes, chosen by `redirectType === "recovery"`). |
| Onboarding | `(app)/layout.tsx` `OnboardingGate` | App pages render only after `profiles.onboarded_at` is set. |

- **Errors:** Supabase Auth codes map to fixed messages (`src/lib/auth/errors.ts`). Sign-up and password-reset requests answer the same way whether or not the email has an account.
- **Cache Components:** the shell (sidebar, bottom bar) is static. Anything that reads the session streams in behind `<Suspense>` or a `loading.tsx` skeleton.
- **Theme:** a `localStorage` preference (`light` / `dark` / `system`), applied before first paint by an inline `<head>` script (`src/lib/theme.ts`). It is kept per device, not in the profile.
- **Navigation:** `src/components/layout/nav-config.ts` lists Dashboard, Groups, Friends, Activity and Add Expense. Pages that don't exist yet are marked `available: false` and show as disabled "Soon" items. Set the flag in the milestone that builds each page.

# Friends, groups and invitations (M4)

| Piece | Where | Notes |
| --- | --- | --- |
| Data access | `src/server/friends.ts`, `src/server/groups.ts`, `src/server/invitations.ts` | Reads go through RLS and the read RPCs. Names come from `profile_cards` (`src/server/people.ts`). Balances come from `friend_balances()` / `group_balances()`, grouped per person and currency by `src/lib/accounting/person-balances.ts`, so they reflect the real ledger (all zero until expenses exist in M5). |
| Writes | `src/server/actions/{friends,groups,invitations}.ts` | Every action validates with Zod (`src/lib/validation/{friends,groups}.ts`), re-checks the session, and calls one RPC. RPC errors become user-safe messages through `rpcFailure` / `src/lib/db/rpc-error.ts`: `SM4xx` messages pass through, everything else is generic. |
| Invitation links | `src/lib/groups/invite-link.ts` | `/invite/{token}?group={groupId}`. The token alone decides the group. The group ID lets the page and `accept_invitation` refuse a token presented for another group. The raw token exists only in the inviter's action result; the database stores its hash, so a link is shown once. |
| Acceptance page | `src/app/invite/[token]/page.tsx` | A **public** route, outside the app shell:<br>• Signed out: links to sign up or log in with `?next=` set to the invitation.<br>• Not onboarded: sent to `/onboarding?next=…`.<br>• Otherwise: `invitation_preview` shows the group, or why the link can't be used, without consuming it.<br>The page sets `referrer: no-referrer` and `noindex`. |
| Coming back after sign-up | `src/server/after-auth.ts` | The confirmation email can't carry `next` (the templates append their own query string). So sign-up stores it in a 24-hour httpOnly cookie, and `/auth/confirm` turns it into `/onboarding?next=…`. If the link is opened in another browser, the user lands on the dashboard and can reopen the invitation. `safeNextPath` allows `/invite/…` as the one public destination. |
| Email invitations | `createEmailInvite` | Single-use and bound to the email. No email is sent by the app (SPEC §15): the inviter gets the link plus a `mailto:` draft. Existing users also see it under "Invitations for you" on the Groups page (`my_group_invitations`). |
| Leave / remove | Group page | The buttons appear only when the balance is zero in every currency, and the RPCs enforce it again (SM409). |

- **Group pages:** tabs are Expenses (`/groups/[id]`, since M5), Members (`/groups/[id]/members`) and Settings (`/groups/[id]/settings`). A balances tab comes in M6. A former member sees only the header and a notice.
- **Nav and dynamic routes:** the nav reads `usePathname()` inside `<Suspense>` (`WithPathname` in `app-nav.tsx`). Otherwise routes with dynamic segments could not prerender their static shell.

# Expenses (M5)

| Piece | Where | Notes |
| --- | --- | --- |
| Form values → split | `src/lib/expenses/resolve.ts` | `resolveExpense(values)` takes the form exactly as typed (decimal strings) and returns the total, payers, shares (with rounding units), basis points / weights and pairwise debts, all from `src/lib/accounting`. Otherwise it returns field-level issues such as `people.1.exact` or `payers`. It is deterministic. The browser uses it for the live preview, and the server runs it again from the same strings. |
| One schema | `src/lib/validation/expenses.ts` | `expenseFormSchema` checks the structure and then calls `resolveExpense` in `superRefine`, so the form and the Server Action reject the same things. It adds one check of its own: a direct expense must involve both friends. |
| RPC payload | `src/lib/expenses/payload.ts` | `buildExpensePayload` produces the snake_case `p_payers` / `p_participants` / `p_ledger_entries` / `p_items` that `create_expense` and `update_expense` validate. Item assignments follow the people's entry order. |
| Server Actions | `src/server/actions/expenses.ts` | `createExpense` (idempotency key from the form, created once per form and reused on retry), `updateExpense` (expected version; a stale one is SM409), `cancelExpense`, `addComment`, `deleteComment` (soft delete). |
| Reads | `src/server/expenses.ts` | `getExpenseFormOptions` returns groups with current members in join order, plus friends. `getExpense` returns the current version, items, history from `audit_events`, comments, and whether the caller may change or comment on it (mirroring `lock_expense_for_change` / `can_edit_expense`). `listGroupExpenses` pages 20 at a time and includes cancelled expenses, labelled. `listDirectExpenses` lists direct expenses with one friend. |
| History | `src/lib/expenses/history.ts` | Parses the `expense_snapshot` JSON in audit rows defensively. `describeChanges` lists what changed (description, amount, date, category, split, paid by, shares) with before and after values. |

- **Pages:**
  - `/expenses/new`: `?group=` or `?friend=` preselects where the expense goes; `?from=` duplicates an expense, dated today.
  - `/expenses/[id]`: detail, history and comments.
  - `/expenses/[id]/edit`.
- **Saving is blocked until the split resolves.** The submit button is disabled while pending and while the preview has issues. Description and date are checked on submit.
- **Exclusions:** unticked people are not participants. A 0% share in a percentage split is stored as a zero share. Payers don't have to take part.
- **Amounts in the browser are never trusted:** the action receives the typed strings, not computed minor units.

# Notifications, search, analytics and exports (M8)

| Piece | Where | Notes |
| --- | --- | --- |
| Notification wording | `src/lib/notifications/describe.ts` | One sentence (and an optional second line) per type, from the recipient's side, with the link it leads to. Every `data` field is checked; malformed JSON gives plainer wording, unknown types are skipped. |
| Types and preferences | `src/lib/notifications/types.ts` | The list matches the `notification_type` domain (a unit test compares them). `preferenceMap` fills in "on" for types without a row. |
| Reads and actions | `src/server/notifications.ts`, `src/server/actions/notifications.ts` | `loadNotifications(client, page)` pages 25 at a time. `markNotificationsRead` (no refresh: it also runs as the viewer follows a link), `markAllNotificationsRead`, `saveNotificationPreferences` (all types at once). |
| Unread badge | `src/components/notifications/unread-count.tsx`, `GET /notifications/unread-count` | The badge (sidebar, phone menu, phone header bell) asks the endpoint on every navigation, when the tab becomes visible and when notifications are marked read (a window event). Requests are shared between badges. No Realtime (SPEC §15 allows polling on navigation). |
| Search | `src/server/search.ts`, `/search?q=` | Friends (accepted friendships, by name) and groups (current and former, names via `group_names`) are filtered in TypeScript with the same word matching as `search_expenses`; expenses come from that RPC, 20 per page. A plain GET form, so results have URLs. |
| Analytics | `src/lib/analytics/{periods,aggregate}.ts`, `src/server/analytics.ts`, `/analytics` | One set of rows (`my_expense_shares`, completed settlements, active templates, ledger balances) feeds every figure, so tables and charts add up to the database totals (tested against SQL sums in `tests/integration/analytics-exports.test.ts`). Amounts stay integers per currency; charts show one currency at a time. |
| CSV export | `src/lib/export/csv.ts`, `src/server/exports.ts`, `GET /analytics/export?kind=expenses\|settlements&…` | Built on the server with the viewer's own session, so RLS decides what can appear. Same filters as the page. |

- **Words (SPEC §14):** *spending* is the viewer's share; *you paid* is what they put in; *owed* is the balance now from the ledger, shown apart and labelled "all time"; *repayments* are completed settlements in the period. The page explains each one.
- **Periods:** presets end today in the profile's time zone (this month, last 3/6/12 months, this year) or custom dates up to three years. Weeks start on Monday; weekly buckets only up to about a year. Empty weeks and months show as zero.
- **Recurring costs:** spending in the period from expenses a schedule added, per schedule, and active schedules per frequency with your share each time and an approximate yearly cost (365 days, 52 weeks, 12 months), labelled "≈".
- **Charts:** Recharts, one series in the brand green, bars at most 24 px with 4 px rounded ends, hairline grid. Each chart has a title, a one-sentence summary (figure caption and SVG `<desc>`), Recharts' keyboard layer and a Chart / Table toggle; the table is always in the page. Breakdowns show 8 bars (the rest as "Everything else"); tables show every row with a total.
- **Large ranges:** the app reads at most 20,000 rows per report or export; beyond that it asks for a shorter range rather than showing partial totals.
- **CSV:** RFC 4180 quoting, CRLF line endings, a UTF-8 byte-order mark for spreadsheet apps, exact decimal amounts (`minorToDecimalString`), and a leading apostrophe on text that a spreadsheet would run as a formula (`=`, `+`, `-`, `@`; plain negative numbers are left alone). The expenses file lists active expenses you take part in; the repayments file lists every status.
- **Printing:** `@media print` in `globals.css` hides the navigation and buttons, switches to the light palette, hides charts and shows their tables, and keeps rows and headings from splitting across pages. "Print or save as PDF" calls `window.print()`; no PDF library.


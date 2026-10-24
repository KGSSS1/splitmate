# Database

SplitMate uses Supabase Postgres. Everything is defined in `supabase/migrations/`. Synthetic local data lives in `supabase/seed.sql`, and the pgTAP tests in `supabase/tests/`. The accounting rules the database enforces are described in [architecture.md](architecture.md).

## Local setup and reset

Docker must be running.

| Task | Command |
| --- | --- |
| Start the local stack | `npm run db:start` |
| Rebuild the database from scratch (all migrations + seed) | `npm run db:reset` |
| Run the pgTAP tests | `npm run db:test` |
| Regenerate TypeScript types after a migration | `npm run db:types` → `src/types/database.types.ts` |
| Lint functions (plpgsql_check) | `npx supabase db lint --local --level warning` |
| Security and performance advisors | `npx supabase db advisors --local --type all --level warn` |
| Stop the stack | `npm run db:stop` |

`db:reset` only touches the local database. Never run `supabase db reset --linked` or `supabase db push` without explicit approval (see `CLAUDE.md`).

### Seed users (local only)

`seed.sql` creates four synthetic users. All of them use the password `splitmate-local-dev`.

| Email | Role in seed data |
| --- | --- |
| alice@example.test | admin of "Flat 4B"; paid ₹900 for groceries (split equally) |
| bob@example.test | member; has a pending ₹100 UPI repayment to Alice |
| carol@example.test | member |
| dave@example.test | outsider with no groups or friends (useful for denial checks) |

The seed builds its data through the same RPC functions the app uses, so it is always consistent with the rules below. Local auth emails can be read in Mailpit at <http://127.0.0.1:54324>.

## Schema overview

| Area | Tables |
| --- | --- |
| Identity and social | `profiles`, `friendships`, `groups`, `group_members`, `group_invitations` |
| Expenses and accounting | `expenses`, `expense_payers`, `expense_participants`, `expense_items`, `expense_item_assignments`, `settlements`, `ledger_entries` |
| Other | `recurring_expenses`, `recurring_occurrences`, `attachments`, `comments`, `notifications`, `notification_preferences`, `audit_events` |

`exchange_rates` is added only when currency conversion is implemented (M9).

Conventions:
- **Keys and timestamps:** UUID primary keys and `created_at`. Mutable tables also have `updated_at`, maintained by a trigger. Insert-only tables (versioned expense rows, `ledger_entries`, `audit_events`) have only `created_at`.
- **Amounts:** stored with the `minor_amount` domain, a `bigint` in the range 1..9,007,199,254,740,991 (the TypeScript safe-integer limit). Participant shares use `share_amount` (0 allowed). Currencies use `currency_code`, whose check lists the supported ISO 4217 codes; it must match `src/lib/money/currencies.ts` (a unit test enforces this). Expense and settlement dates must fall between 2000 and 2100, and the expense RPCs also reject dates more than a year ahead. Tags are limited to 20, each 1–40 characters.
- **Status fields** are `text` with `CHECK` constraints, not enums.
- **Expense versions:** payer, participant and item rows are stored per expense version and never overwritten, so the full history of every edit is kept.
- **Expense and settlement idempotency:** each has an `idempotency_key`, unique per creator.

### Ledger

`ledger_entries` is the source of truth for balances. Each row says `debtor_id` owes `creditor_id` an `amount` in a `currency`, within a `group_id` (null for direct), linked to exactly one expense (with `source_version`) or settlement.
- **Append-only:** a trigger rejects every `UPDATE` and `DELETE`, for every role. `audit_events` has the same trigger.
- **Edit:** reversal rows for the current version, copied from the stored rows, then charges for the new version.
- **Cancel:** reversal rows only.
- **Settlements:** a settlement writes a row only when `completed`, with direction receiver → payer. Cancelling a completed settlement writes its reversal.

Balances are computed, never stored:
- `public.group_balances(group_id)` gives each member's net per currency.
- `public.friend_balances()` gives the caller's net with each friend, across all groups and direct expenses.
- `public.my_group_balances()` gives the caller's net in each group (including groups they have left; callers filter).
- `public.friend_group_balances(friend_id)` gives the caller's raw pairwise balance with one person, per group (null = direct) and currency.
- `public.my_pairwise_balances()` gives the caller's raw pairwise balances with everyone, per group and currency, flagged `simplified` when the group simplifies debts.
- `public.my_simplified_group_balances()` gives every member's net in the caller's current simplify-on groups. It is the input to the simplified plan that friend-level views follow (`docs/architecture.md`).
- `public.group_pairwise_balances(group_id)` gives who owes whom inside a group, netted per pair and currency. These are the suggested repayments when the group's simplify-debts toggle is off; with it on, the app simplifies `group_balances` with `src/lib/settlements`.

All of them only sum ledger rows and run with the caller's rights, so RLS applies.

### Deletion rules

- Every foreign key into financial, membership or history tables is `ON DELETE RESTRICT`. Nothing cascades from a profile or group.
- `profiles.id` equals `auth.users.id` but has **no foreign key** to it. Account deletion (M9) anonymizes the profile (name "Deleted user", email and avatar removed, `deleted_at` set) and then deletes the auth user. Expenses and ledger rows keep pointing at the profile, so other members' balances stay correct.
- A member can leave, or be removed by an admin, only when their balance in the group is zero in every currency. The membership row stays (`left_at`, `removed_by`), so history remains readable. If the last admin leaves, the longest-standing remaining member becomes admin.
- Leaving or removal also revokes the member's open invitations and cancels their pending settlements in that group; both parties are notified.
- An expense that involves a former member can no longer be edited or cancelled. Changing it would give that person a balance they could no longer settle.

## Security model

- **RLS everywhere:** RLS is enabled on every public table, and anything not granted is denied. `anon` has no table privileges and cannot execute any SplitMate function.
- **Policy helpers:** policies call `SECURITY DEFINER` helpers in the `private` schema, such as `is_group_member`, `can_view_expense` and `can_view_settlement`. This avoids recursive policies on `group_members`. The `private` schema is not exposed through the API.
- **Reads:**
  - Current group members see the whole group.
  - Former members see the group plus their own expenses and ledger rows.
  - Direct expenses and settlements are visible only to the two people involved.
  - Other people's names and avatars come only from `public.profile_cards(ids)`, limited to people who share a group or friendship with the caller.
- **Direct writes are limited to specific columns:**
  - own profile fields
  - group settings (admins)
  - own notification preferences
  - marking notifications read
  - comments
  - attachments
- **Money writes** go only through the RPC functions below. They are `SECURITY DEFINER` with `search_path = ''`, because clients have no write privileges on those tables. Each one checks `auth.uid()` explicitly, locks the rows it changes, validates the invariants, and writes the ledger, audit event and notifications in one transaction.
  - On hosted projects, Supabase's advisor rule 0029 ("Signed-In Users Can Execute SECURITY DEFINER Function") flags each of these RPCs, plus `profile_cards`, as a WARN. That is intended: `authenticated` must be able to call them, and the authorization checks live inside each function, covered by the pgTAP suite.
  - Treat a 0029 warning on any **other** function as a real finding.
- **New tables** get no privileges by default. The default grants for `anon`/`authenticated` are revoked, so every new table needs explicit `GRANT`s and policies.
- **Friend requests by email** (`send_friend_request`) are stored by the address typed (`friend_email_requests`, visible only to the sender). The reply is `sent` whether or not the address has an account, so lookups reveal nothing. A request to an address without an account becomes a pending friendship when that address signs up and is confirmed (trigger `on_auth_user_created_friend_requests` / `on_auth_user_confirmed_friend_requests`). Every request counts toward the rate limit: 30 per user per hour, stored in `private.rate_limit_events` (not exposed through the API).
- **Groups:** only current members read `groups` (L9). History pages get names through `group_names()`: the live name for members, the name when they left for former members (`group_members.left_group_name`). Settings change only through `update_group`; there is no direct UPDATE (L10).
- **Invitations:** `invited_email` isn't readable from the table. `group_invitation_list()` returns it in full to the invitation's creator and group admins and masked (`z•••@example.com`) to other members; audit events store it masked (L11).
- **Amounts:** one expense may not exceed `private.currency_max_amount(currency)` (about US$100,000 per currency, mirrored in `src/lib/money/currencies.ts`). The trigger `ledger_entries_balance_range` refuses any ledger write that would push a person's sum of absolute pairwise balances in a currency past 2^53 − 1 (M2).
- **Split details** (`private.check_split_details`): stored percentages, weights and rounding flags must match the shares; itemized shares can't exceed a person's assigned items plus charges (M3).
- **Locking:** an expense edit or cancel share-locks the memberships of the actor and everyone in the current version, so `leave_group` / `remove_group_member` wait for it (M1).
- **Invitation tokens** are 256 random bits. They are returned once by `create_invitation`, and only their SHA-256 hash is stored.
  - An invitation is valid only while its creator is a current member.
  - An invitation addressed to an email requires that email to be confirmed.
  - The 20-per-hour limit is serialized with a per-user advisory lock.
- **Pairwise entries are checked against the payments.** Each ledger row of an expense must run from someone with a negative net (paid less than their share) to someone with a positive net. Every debtor × creditor amount must be within one minor unit of `|debt| × excess / total excess`. A client calling the RPC directly therefore cannot reroute debts, even though SQL never computes the split itself.
- **Payload limits:** at most 100 payers, 100 participants, 200 item lines and 10,000 ledger rows per expense; at most 200 IDs per `profile_cards` call.
- **Former members** cannot act on group settlements, edit their old comments, or see people who joined after they left.
- **Deleted accounts** cannot write comments, attachments or receipts, even with a token that is still valid.

### Receipts storage

- **Bucket:** private bucket `receipts`, limited to 5 MB and JPEG/PNG/WebP/PDF.
- **Paths:** objects live at `{expense_id}/{file}`.
- **Policies:**
  - Read: anyone who can see the expense.
  - Upload: anyone who can edit it (current group members, or the two friends of a direct expense), with `owner_id` equal to the uploader.
  - Delete: only the uploader.
- Files are served with short-lived signed URLs (M7).

## RPC functions

All functions require a signed-in user. Payloads use minor units, and the shares and pairwise entries come from `src/lib/accounting`; SQL never re-implements split math.

| Function | Purpose |
| --- | --- |
| `create_group(name, default_currency?, description?, group_type?, simplify_debts?)` | Creates a group; the caller becomes admin. Types: `trip`, `home`, `couple`, `other` |
| `update_group(group_id, name, description, default_currency, group_type, simplify_debts)` | Admins only; audited with before and after |
| `set_member_role(group_id, user_id, role)` | Admins promote or demote; the last admin cannot be demoted |
| `create_invitation(group_id, invited_email?, max_uses?, expires_in_hours?)` | Returns `(invitation_id, token)`; any member; limited to 20 per user per hour |
| `accept_invitation(token? \| invitation_id?, group_id?)` | Joins the group and befriends every member; no-op if already a member |
| `revoke_invitation(invitation_id)` | The invitation's creator or an admin |
| `invitation_preview(token, group_id?)` | Status for the acceptance page (`valid`, `member`, `not_found`, `wrong_group`, `wrong_email`, `revoked`, `expired`, `used`, `inactive`). Group details only for `valid`/`member`; does not consume a use |
| `my_group_invitations()` | Open invitations addressed to the caller's email |
| `send_friend_request(email)` | Exact email match. Returns `sent` (whether or not the address has an account), `accepted` (they had asked you), `already_friends` or `self`; rate limited |
| `withdraw_friend_request(request_id)` | The sender removes a request from their list (and its pending friendship, if any) |
| `accept_friend_request(friendship_id)` / `delete_friend_request(friendship_id)` | The recipient accepts; either side declines or withdraws a pending request |
| `leave_group(group_id)` / `remove_group_member(group_id, user_id)` | Zero balance in every currency required; removal is for admins |
| `create_expense(idempotency_key, group_id \| null, …, payers, participants, ledger_entries, items?)` | Group expense among current members, or a direct expense between two friends |
| `update_expense(expense_id, expected_version, …)` | Version check; reverses the current version and writes the next one; returns the new version |
| `cancel_expense(expense_id, expected_version)` | Reversals only |
| `create_settlement(idempotency_key, group_id \| null, payer_id, receiver_id, amount, currency, …)` | Completed if the receiver records it, pending if the payer does |
| `confirm_settlement` / `reject_settlement(settlement_id)` | Receiver only, while pending |
| `cancel_settlement(settlement_id)` | Payer withdraws a pending settlement (status `withdrawn`, no ledger effect); either party cancels a completed one (status `cancelled`, reversal). Leaving a group withdraws the leaver's pending settlements there |
| `direct_expenses_with(friend_id, limit?, offset?)` | Direct expenses between the caller and one friend, newest first, with `total_count` |
| `group_names(group_ids)` | Names of groups the caller is or was in |
| `group_invitation_list(group_id)` | A group's invitations for current members, addresses masked unless creator or admin |
| `settle_up_with_friend(idempotency_key, friend_id, items, method?, upi_reference?, note?, settled_on?)` | `items` are `[{group_id, currency, amount}]`, computed by the server; positive amount = the friend pays the caller. One settlement per item, in one transaction. Checks: raw contexts must match the pairwise balance exactly; simplify-on groups need the right direction and no more than either net (SM409 otherwise); both people must be current members of each group (SM403). Owed to the caller → completed; owed by the caller → pending. The key is stored as `settlements.batch_id`, so a retry (even a concurrent one) returns the same IDs |
| `group_balances(group_id)`, `friend_balances()`, `my_group_balances()`, `friend_group_balances(friend_id)`, `group_pairwise_balances(group_id)`, `my_pairwise_balances()`, `my_simplified_group_balances()`, `my_activity(limit, offset)`, `profile_cards(user_ids)` | Read helpers |

### Error codes

Functions raise these SQLSTATEs. The message is safe to show to users. `23xxx` codes come from constraints and should be shown as a generic "invalid input".

| Code | Meaning |
| --- | --- |
| `SM401` | not signed in, or account deleted |
| `SM403` | not allowed (not a member, not a party, not an admin, not friends) |
| `SM404` | not found, or not visible to the caller |
| `SM409` | conflict: stale version, already cancelled/confirmed/used/expired/revoked, non-zero balance |
| `SM422` | invalid input (sums don't match, unknown currency, …) |
| `SM429` | rate limited |

## Tests

`supabase/tests` runs in file order:
- `000_helpers` installs the `tests` schema (user creation, `authenticate_as`, payload builders) and commits; it exists only in the local database.
- Each other file runs in a transaction and rolls back.

| File | Covers |
| --- | --- |
| `010_schema` | RLS on every table, privileges, constraints, deletion rules, triggers, append-only tables, the bucket |
| `020_rls` | Reads and writes for a member, a non-member, a removed member, a direct-expense friend and an anonymous user, table by table |
| `030_expenses` | Create (including multi-payer and itemized), idempotency, every validation, edit with reversals, stale version, cancel, audit, notifications |
| `040_settlements` | All status transitions, who may act, never counted twice, reversals, the SPEC §17 numbers |
| `050_invitations` | Hashed tokens, acceptance and auto-friendship, expired, revoked, reused, wrong-group and wrong-email tokens, rate limit |
| `060_membership` | Leave and remove rules across currencies, what a removed member can no longer do, admin handover, rejoining |
| `070_storage` | Receipt upload, read and delete permissions |
| `080_balances` | Group and friend balances, currency separation, ledger sums to zero |
| `090_security_review` | Regression tests for the findings of the M2 security review (rerouted debts, rejoining after removal, frozen history, and more) |
| `100_service_role_grants` | Explicit `service_role` grants (hosted projects no longer add them by default) |
| `110_friends_groups` | Group type and settings, member roles, friend requests (all outcomes, rate limit), invitation preview, invitations addressed to you |
| `120_balances_settle_up` | The M6 balance read functions (including outsiders seeing nothing), "settle up everything" (statuses, idempotent retry, skipped groups, notifications), settlement input checks, privileges |
| `130_review_m6` | Review M6 Highs: a removed member can't rejoin through an older link; `my_activity` visibility and cost |
| `140_review_batch1` | Review batch 1: `withdrawn`, one open payment per debt, per-currency maximum and balance range, split-detail checks, history and empty saves, neutral friend requests, former members and group names, no direct group updates, masked invitee addresses |
| `150_review_batch2` | Review batch 2: idempotency keys scoped to their creator (expenses, settlements, settle-up batches); pairwise balances net debts in both directions |

"Concurrent edit" is tested sequentially: an edit based on a stale version is rejected. Real concurrent edits are serialized by the `FOR UPDATE` lock on the expense row.

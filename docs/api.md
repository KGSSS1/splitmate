# API

SplitMate has no public REST API of its own. The browser talks to three kinds of server entry points, all of which re-check identity and permissions:

1. **Server Actions** (`src/server/actions/*.ts`): called from forms and buttons.
2. **Route handlers** (`src/app/**/route.ts`): downloads, redirects and the unread count.
3. **Supabase** (Postgres via the Data API, Auth, Storage): called **from the Next.js server** with the user's session. The browser never gets a database client.

Anyone holding a session could still call Supabase's Data API directly with the publishable key, so the database checks everything on its own: RLS on every table and explicit checks in every function (`SECURITY.md`).

Conventions:

- **Money:** integers in the currency's minor unit (`90000` INR = ₹900.00, `1500` JPY = ¥1,500); never floats.
- **Dates:** `YYYY-MM-DD` for calendar dates (expenses, settlements); ISO timestamps for events.
- **IDs:** UUIDs. Retried writes take an `idempotency_key` (UUID) scoped to its creator.
- **Errors:** functions raise SQLSTATEs with user-safe messages. `SM401` not signed in or account deleted; `SM403` not allowed; `SM404` not found or not visible; `SM409` conflict (stale version, wrong state, non-zero balance); `SM422` invalid input; `SM429` rate limited. `src/lib/db/rpc-error.ts` maps them, and anything else becomes a generic message.

## Database functions (RPC)

Called as `supabase.rpc(name, args)` by the signed-in user. Only `authenticated` may execute them; `anon` can't. **D** = SECURITY DEFINER (checks done inside); **I** = SECURITY INVOKER (RLS applies).

### Groups, members and invitations

| Function | | Who may call it, and what it checks |
| --- | --- | --- |
| `create_group(name, default_currency?, description?, group_type?, simplify_debts?)` → id | D | Any signed-in user; becomes the admin. |
| `update_group(group_id, name, description, default_currency, group_type, simplify_debts)` | D | Admins only. |
| `set_member_role(group_id, user_id, role)` | D | Admins only, for current members. |
| `create_invitation(group_id, invited_email?, max_uses?, expires_in_hours?)` → (id, token) | D | Current members. Rate limit 20/h. The token is returned once and stored hashed. An invitation by email notifies an existing user in-app. |
| `revoke_invitation(invitation_id)` | D | Its creator or an admin. |
| `invitation_preview(token, group_id)` | D | Anyone signed in with the link: the group name and inviter, nothing else. |
| `accept_invitation(token?, invitation_id?, group_id?)` → group id | D | A valid token (not expired, revoked or used up, right group), or an invitation addressed to the caller's confirmed email. The creator must still be a member. Joining makes the members friends. |
| `my_group_invitations()`, `group_invitation_list(group_id)` | D | Your own pending invitations; a group's invitations for its current members, with addresses masked unless you're the creator or an admin. |
| `leave_group(group_id)`, `remove_group_member(group_id, user_id)` | D | Only at a zero balance in every currency. Removal is admin-only. Revokes the member's invitations, withdraws pending repayments in the group and hands over admin if needed. |
| `group_names(group_ids)` | D | Names of groups you are or were in (the name when you left, for former members). |

### Friends

| Function | | Checks |
| --- | --- | --- |
| `send_friend_request(email)` → (status, request_id, friend_id) | D | Exact email. The reply is `sent` whether or not the address has an account, and `friend_id` is returned only when it reveals nothing (an existing friendship, or their pending request to you). Rate-limited. |
| `accept_friend_request(friendship_id)`, `delete_friend_request(friendship_id)`, `withdraw_friend_request(request_id)` | D | Only the recipient accepts or declines; the sender withdraws by request ID. |
| `profile_cards(user_ids)` | D | Names of people you share a group or friendship with (or who asked to be your friend). "Deleted user" for deleted accounts. |

### Expenses and recurring expenses

| Function | | Checks |
| --- | --- | --- |
| `create_expense(idempotency_key, group_id \| null, description, amount, currency, expense_date, split_method, payers, participants, ledger_entries, items?, category?, notes?, tags?)` → id | D | Current group members (or the two friends for a direct expense). Validates the payload computed by `src/lib/accounting`: payers and shares sum to the amount, pairwise debts follow the payments, everyone involved is a current member or the friend, currency and per-currency limits. A retry with the same key returns the same expense. |
| `update_expense(expense_id, expected_version, …)` → version | D | As above, plus a matching `expected_version` (else SM409), the expense still active, and nobody involved has left the group (or stopped being friends, for a direct expense). Writes reversing and new ledger entries. A save with no changes keeps the version. |
| `cancel_expense(expense_id, expected_version)` | D | Same rules; writes reversing entries only. |
| `create_recurring_expense(…)`, `update_recurring_expense(recurring_id, expected_version, …)`, `set_recurring_expense_status(recurring_id, status)` | D | Same membership rules. Templates store the resolved split; `pg_cron` creates the expenses. |
| `direct_expenses_with(friend_id, limit?, offset?)` | I | Your direct expenses with one friend. |
| `search_expenses(query, categories?, limit?, offset?)` | I | Expenses you can see whose text contains every word (≤ 100 characters, SM422 otherwise). |

### Settlements and balances

| Function | | Checks |
| --- | --- | --- |
| `create_settlement(idempotency_key, group_id \| null, payer_id, receiver_id, amount, currency, method?, upi_reference?, note?, settled_on?)` → id | D | The caller is the payer or the receiver, and both are current members (or friends). Recorded by the receiver = completed at once; by the payer = pending until the receiver confirms. One open payment per debt. |
| `confirm_settlement(id)`, `reject_settlement(id)` | D | The receiver only, while pending. |
| `cancel_settlement(id)` | D | The payer withdraws a pending one (no ledger effect); either party cancels a completed one (reversed). |
| `settle_up_with_friend(idempotency_key, friend_id, items, …)` | D | One settlement per group and currency, in one transaction. Each amount is checked against the balance (raw, or the simplified plan). |
| `group_balances`, `group_pairwise_balances`, `friend_balances`, `friend_group_balances`, `my_group_balances`, `my_pairwise_balances`, `my_simplified_group_balances` | I | Balances computed from the ledger; RLS limits the rows. |

### Activity, notifications, analytics, rates and the account

| Function | | Checks |
| --- | --- | --- |
| `my_activity(limit?, offset?)` | I | Expense and settlement history you can see. |
| `mark_notifications_read(ids?)` → count | I | Your own notifications only (at most 100 IDs; none = all unread). |
| `set_notification_preferences(preferences jsonb)` | I | `{"expense_added": false, …}`; unknown types and non-booleans are SM422. |
| `my_expense_shares(from, to, limit?, offset?)` | I | Your paid amount and share per active expense in a date range, at most 1000 rows per page (analytics and CSV). |
| `latest_exchange_rates()` | I | The newest stored rate per currency, as exact decimal text (display only). |
| `delete_my_account(confirmation)` | D | `confirmation` must be `DELETE`. Refused while any group or direct balance is open (SM409). Then, in one transaction: leaves groups, withdraws pending repayments, cancels your recurring expenses, removes friendships, notifications and preferences, anonymizes the profile and deletes the auth user (every session ends). |

### Direct table access

The app reads tables with `supabase.from(…).select()`, and RLS decides the rows. The only direct writes allowed are:

- your profile's `display_name`, `avatar_url` (https only), `default_currency`, `locale`, `timezone` and `onboarded_at`;
- `notifications.read_at`;
- your `notification_preferences`;
- comments on expenses you can edit;
- `attachments` rows for files you uploaded.

## Route handlers

| Route | Method | Who | Returns |
| --- | --- | --- | --- |
| `/auth/confirm` | GET | Public | Email links. `?token_hash=…&type=…` redirects to `/auth/continue` (nothing is verified until **Continue** is pressed); `?code=…` (PKCE, same browser only) signs in and redirects to onboarding or the new-password page. Bad links go to `/login?error=link`. |
| `/analytics/export?kind=expenses\|settlements&range=…&from=…&to=…&by=…&currency=…` | GET | Signed in, onboarded | CSV attachment (`no-store`) of your expenses or repayments in the range. 400 for bad filters, 413 when over 20,000 rows. |
| `/settings/export?format=json` or `?format=csv&dataset=<name>` | GET | Live session | Everything your account can see, as one JSON file or one CSV per dataset: `profile`, `friendships`, `sent_friend_requests`, `group_memberships`, `groups`, `expenses`, `expense_payers`, `expense_participants`, `expense_items`, `expense_item_assignments`, `comments`, `receipts`, `settlements`, `ledger_entries`, `recurring_expenses`, `recurring_occurrences`, `notifications`, `notification_preferences`, `history`. 413 when a dataset is over 50,000 rows. |
| `/notifications/unread-count` | GET | Signed in (else 401) | `{"unread": n}`, `no-store`. Polled by the badge on navigation. |
| `/expenses/[expenseId]/receipts/[attachmentId]` | GET | Anyone who can see the expense | 302 to a 60-second signed Storage URL; 404 otherwise. |
| `/manifest.webmanifest`, `/sw.js`, `/offline.html` | GET | Public | PWA files. `sw.js` is `no-store` and limited to same-origin scripts. |

## Server Actions

Each one runs on the server, validates its input with the Zod schema in `src/lib/validation/`, checks identity (`requireUser`, `requireOnboardedProfile` or `requireLiveSession`), calls the RPC above and returns `{ ok: true, message? }` or `{ ok: false, error, fieldErrors? }` with user-safe text. Some redirect instead.

| File | Actions |
| --- | --- |
| `auth.ts` | `signUp`, `signIn`, `signOut`, `resendConfirmation`, `requestPasswordReset`, `updatePassword` (live session), `confirmEmailLink` (the Continue button) |
| `profile.ts` | `completeOnboarding`, `updateProfile` |
| `friends.ts` | `addFriend`, `acceptFriendRequest`, `deleteFriendRequest`, `withdrawFriendRequest` |
| `groups.ts` | `createGroup`, `updateGroup`, `setMemberRole`, `removeMember`, `leaveGroup` |
| `invitations.ts` | `createInviteLink`, `createEmailInvite`, `revokeInvitation`, `acceptInvitation`, `acceptInvitationById` |
| `expenses.ts` | `createExpense`, `updateExpense`, `cancelExpense`, `addComment`, `deleteComment`. Amounts arrive as the typed strings, and the server computes the split with `src/lib/accounting`. |
| `recurring.ts` | `createRecurringExpense`, `updateRecurringExpense`, `setRecurringStatus` |
| `receipts.ts` | `prepareReceiptUpload` (signed upload URL), `attachReceipt` (checks the file's bytes, type and size, then records it), `deleteReceipt` |
| `settlements.ts` | `createSettlement`, `confirmSettlement`, `rejectSettlement`, `cancelSettlement`, `settleUpEverything` |
| `notifications.ts` | `markNotificationsRead`, `markAllNotificationsRead`, `saveNotificationPreferences` |
| `account.ts` | `deleteAccount` (live session; type DELETE) |

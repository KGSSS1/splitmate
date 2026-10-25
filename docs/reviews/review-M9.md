# Security review, M9 (2026-10-25)

An independent, read-only review against SPEC §8 by a fresh subagent, run on the local stack after the M9 features were written. It read the migrations, policies and grants, every Server Action and route handler, the proxy, the service worker and the headers. It checked each suspected issue with SQL run as test users inside rolled-back transactions. Nothing was changed by the review itself.

## Findings and what was done

| ID | Severity | Finding | Fix | Regression test |
| --- | --- | --- | --- | --- |
| M1 | Medium | **A friend request by email revealed whether the address has an account.** The reply was neutral, but the sender could read the pending `friendships` row (with the recipient's ID) and the `friend.requested` / `friend.withdrawn` audit rows naming the recipient. Both existed only when the address had an account. The data export handed them out too. | The `friendships_select_own` policy hides pending rows from their sender (the recipient still sees them). The `audit_events_select` policy no longer shows the actor's own `friend.requested` / `friend.withdrawn` rows. Migration `20261026091000_security_review_m9.sql`. | pgTAP `110_friends_groups`: the sender sees neither the row nor the audit row; the recipient sees the request; acceptance still works. |
| L1 | Low | **A direct expense could be changed after the friendship ended**, e.g. after the other person deleted their account. That left a balance against "Deleted user" that nobody could settle. A race between a friend's expense and `delete_my_account` could end the same way. | `lock_expense_for_change` locks the friendship for direct expenses (FOR SHARE) and refuses (SM409) when the two are no longer friends. `delete_my_account` locks the caller's friendships FOR UPDATE before checking balances. | pgTAP `190_rates_account_deletion`: the friend's direct expense with a deleted account is frozen. |
| L2 | Low | **The receipts bucket accepted any file name and showed unattached files to members.** Any member could upload arbitrary objects under an expense, other members could read them before the content check, and an uploader could delete an attached file and upload different bytes at the same path. | `receipts_insert` accepts only `<expense id>/<uuid>.<jpg\|png\|webp\|pdf>` (what the app generates). `receipts_select` shows an object to other members only once its `attachments` row exists; the uploader can read their own pending upload for the content check. `receipts_delete` refuses while an attachment row references the object. | pgTAP `070_storage` rewritten (17 tests); integration and E2E receipt tests still pass. |
| L3 | Low | **`/auth/confirm` signed the browser in on a plain GET.** A link sent by someone else could sign the victim into the sender's account (login CSRF), and mail scanners that prefetch links used up the one-time token. | Token-hash links now open `/auth/continue`, which does nothing until **Continue** is pressed (a Server Action POST that calls `verifyOtp`). `?code=` (PKCE) links are unchanged: they only work in the browser that started the flow. | `tests/unit/auth/confirm-route.test.ts` (opening uses nothing; Continue verifies; forged fields refused); E2E helpers now press Continue. |

## Hardening suggestions

| Suggestion | Status |
| --- | --- |
| `pg_net` was installed without a schema (advisor `extension_in_public`). | Done: `create extension pg_net with schema extensions`. API roles have no rights in the `net` schema. |
| Revoke the default `anon`/`authenticated` rights on `net` functions and tables. | Done. |
| Add a check to `profiles.avatar_url`, which clients can write but nothing displays yet. | Done: https only, at most 2048 characters. |
| HSTS header. | Done: `Strict-Transport-Security: max-age=63072000; includeSubDomains`. |
| A deleted or logged-out user's access token still passes RLS **reads** until it expires (at most 1 h). | Not changed. Every RPC refuses it (`require_uid` checks `deleted_at`), and every page checks the profile and redirects. Documented in `SECURITY.md`. |
| Sanity bounds on stored exchange rates. | Not changed. Rates come only from the database's own request to Frankfurter, and they are display-only. Documented. |
| Rate limits on expense, comment and settlement creation. | Not changed. Invitations and friend requests have limits; the rest is noted in `SECURITY.md`. |
| A nonce-based Content-Security-Policy. | Not changed. Planned; `frame-ancestors 'none'` and the other headers are in place. |
| The invite token sits in the URL path and can appear in hosting logs. | Accepted and documented. The page sets `no-referrer` and `noindex`; tokens expire and can be revoked. |

## Checked and found sound

The full list is in the reviewer's report:

- **Grants:** no `anon` privileges; `authenticated` reads plus a few column-limited writes; no client writes to `ledger_entries`, `audit_events`, `expenses` or `settlements`.
- **Functions:** every SECURITY DEFINER function pins `search_path` and starts with `require_uid()`; the private helpers aren't exposed.
- **Policies:** no recursive RLS policies; former members see only their own history.
- **Settlements:** only the receiver confirms or rejects; removed members can't act.
- **Invitations:** 256-bit hashed tokens, expiring, revocable, rate-limited.
- **Account deletion:** does what `docs/database.md` describes.
- **Exchange rates:** no user path writes them.
- **App layer:** Zod validation and identity checks in every action and route; error messages are mapped and safe; CSV formula guard.
- **Service worker:** caches only static files.
- **Secrets:** none in the repo or its history.

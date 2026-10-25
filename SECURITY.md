# Security

SplitMate holds people's spending, who owes whom, and their email addresses. This page describes what we protect, how, what is left, and how to report a problem.

## Reporting a vulnerability

Please report security issues **privately** through GitHub: **Security → Report a vulnerability** on <https://github.com/KGSSS1/splitmate> (private vulnerability reporting). Don't open a public issue, and don't test against other people's accounts or data. Include what you did, what happened and what you expected; a proof of concept against your own accounts helps.

We aim to acknowledge reports within a few days. Fixes get a regression test and a note in `docs/reviews/`.

> The repository owner needs to switch on **Settings → Code security → Private vulnerability reporting** for that button to appear.

## What we protect, and from whom

| Asset | Threats |
| --- | --- |
| Balances and the ledger | A user changing what others owe: inventing debts, rerouting them through uninvolved people, clearing their own debt, editing history after someone left. |
| Expenses, receipts, comments | People outside a group, or removed members, reading or changing them. |
| Email addresses and who uses the app | Enumeration through friend requests or invitations; addresses leaking into other people's views, logs or exports. |
| Accounts and sessions | Session theft, login CSRF, open redirects after login, token reuse. |
| The service | Abuse of free-tier quotas through invitations, friend requests and sign-ups. |

We trust Supabase (Postgres, Auth, Storage) and Vercel as platforms. We do not trust the browser: every amount, ID and permission is checked again on the server and in the database.

## How access is controlled

### In the database (the last line of defence)

- **Row Level Security on every exposed table**, deny by default. Supabase's default grants are revoked; each table grants only what it needs. Policies call `SECURITY DEFINER` helpers (`is_group_member`, `can_view_expense`, …) instead of querying `group_members` recursively.
- **No direct writes to financial state.** `expenses`, `settlements`, `ledger_entries` and `audit_events` have no client INSERT, UPDATE or DELETE. Every change goes through a PL/pgSQL function (`supabase.rpc`) that:
  - checks `auth.uid()` (and that the account isn't deleted);
  - checks membership or friendship;
  - locks the rows involved and checks the expected `version`;
  - validates every invariant (payers and shares sum to the total, pairwise debts follow the payments, currencies match, amounts are in range);
  - writes the ledger, audit row and notifications in one transaction.
- **`SECURITY DEFINER` only where needed**, always with `SET search_path = ''`. Internal functions live in the `private` schema, which the API doesn't expose. Public functions are granted to `authenticated` only, never `anon`.
- **Ledger and audit rows are append-only** (triggers refuse UPDATE and DELETE). Edits write reversing entries.
- **History survives.** Leaving a group or deleting an account needs a zero balance first, and profiles are anonymized rather than deleted. Nothing cascades from a profile into financial tables.

The authorization rules are in `docs/SPEC.md` §2 and §8. `docs/database.md` lists every policy and function, and `docs/api.md` lists what each RPC checks.

### In the app

- **Identity on the server** comes from `getClaims()` (a verified JWT), never from `getSession()` alone. Sensitive actions also ask Supabase Auth whether the session is still alive (`requireLiveSession`): changing the password, member roles, leaving a group or removing a member, settling up everything with a friend, data export and account deletion.
- **Every Server Action and route handler** checks identity itself and validates input with Zod. Hidden UI is never the guard.
- **The secret key isn't used by the app at all.** Account deletion runs in a database function, and exchange rates are fetched by the database. `SUPABASE_SECRET_KEY` stays unset on Vercel.
- **Errors shown to users** are fixed messages, or the safe SM-coded messages from the database. SQL errors and stack traces are never shown.
- **Sessions:** cookies are HttpOnly and `SameSite=Lax`, and `Secure` in production. `src/proxy.ts` refreshes the session on each request. Redirects after login only accept same-origin paths (`safeNextPath` rejects `//`, backslashes, dot segments and encoded variants).
- **Email links:** a token-hash link opens a page with a **Continue** button. The token is used only by that button's POST, so mail scanners can't use it up and nobody can be signed into someone else's account just by opening a link.
- **Headers:** `frame-ancestors 'none'` and `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and HSTS. `X-Powered-By` is removed.

### Specific features

- **Friend requests by email** get the same reply whether or not the address has an account. The sender sees the address they typed, never whether it matched; pending requests are visible to the recipient only. They are rate-limited.
- **Invitations:** 256-bit random tokens, stored as SHA-256 hashes, scoped to one group, expiring (1–720 h), revocable, with a use count, and rate-limited (20 an hour). Addresses are visible only to the creator and admins, and are masked in audit rows.
- **Receipts:**
  - They live in a private bucket at `<expense id>/<random id>.<ext>`.
  - The browser uploads them straight to Storage with a signed upload URL, which still runs the bucket's insert policy as the user.
  - The server then checks the real file type from its bytes (JPEG, PNG, WebP, PDF only), its declared type and its size (5 MB) before recording it. Other members can see a file only once it is recorded, and a recorded file can't be swapped.
  - Files are served through short-lived (60 s) signed URLs after an access check.
- **Exports:** CSV and JSON are built on the server with the user's own session, so RLS decides every row. They are sent as `no-store` attachments, and spreadsheet formulas are defused.
- **Account deletion:** one database transaction. It refuses while any balance is open, leaves groups, withdraws pending repayments, cancels the user's recurring expenses, removes friendships, notifications and preferences, anonymizes the profile and deletes the auth user, which ends every session.
- **Exchange rates** are fetched by the database itself (`pg_cron` + `pg_net`, Frankfurter), and no user can write one. They are only used for a labelled, approximate display total.
- **Service worker:** caches only content-hashed build files, icons and a static offline page. It never caches pages, data or Server Action responses.

## Known limitations

- **Access tokens outlive logout or deletion for reads.** `getClaims()` verifies tokens locally, so a token that was valid when issued can still *read* through RLS until it expires (`jwt_expiry` = 1 hour). Database functions refuse deleted accounts, and pages check the profile, but a direct API read with the old token could still see the person's former data for up to an hour.
- **Rate limits** cover sign-in and sign-up (Supabase Auth), invitations and friend requests. Creating expenses, comments and settlements isn't rate-limited yet.
- **Content-Security-Policy** sets only `frame-ancestors`. A nonce-based policy for scripts and styles is planned.
- **Invite tokens sit in the URL path,** so they can appear in hosting access logs. The page sends no referrer and isn't indexed; tokens expire and can be revoked.
- **Free tiers:** Supabase Free pauses inactive projects and caps database, storage and email. Vercel Hobby is for non-commercial use.

## Checks we run

- **pgTAP** (`npm run db:test`): RLS for every table as a member, a non-member, a removed member and an anonymous user, every RPC's checks, and regression tests for every review finding (`docs/reviews/`).
- **Supabase advisors and linter** before each deployment:
  - `npx supabase db lint --linked --level warning`
  - `npx supabase db advisors --linked --type all --level warn`

  The only expected warnings are rule 0029 for the intended public RPCs; the list is in `docs/deployment.md`.
- **Independent security reviews:** after M2 and M6, and this review in M9 (`docs/reviews/review-M9.md`).
- **Before every commit:** no secrets. `.env*` files are git-ignored, and `.env.example` holds names only.

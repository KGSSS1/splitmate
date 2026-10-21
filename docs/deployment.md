# Deployment

SplitMate runs on **Supabase (Free)** for the database, auth and storage, and **Vercel (Hobby)** for the Next.js app (SPEC §19). This document covers the **staging** setup: a hosted Supabase project plus Vercel **preview** deployments made from the CLI. Production comes later (M9) and reuses most of it; see [Later: production](#later-production).

Dashboard labels change from time to time. If a menu item below has moved, use the dashboard's search box.

## What staging looks like

| Piece | Choice | Why |
| --- | --- | --- |
| Database / Auth | Separate hosted Supabase project, e.g. `splitmate-staging` | Staging data never mixes with production. |
| App | Vercel project `splitmate`, **preview** deployments only | Deployed with `npx vercel deploy` from this folder: the repo has no Git remote, so there are no automatic deploys. |
| App URL | Each preview's own URL (`https://splitmate-<hash>-<scope>.vercel.app`) | `NEXT_PUBLIC_APP_URL` stays unset on previews; `next.config.ts` derives it from `VERCEL_URL` (see `resolveAppUrl` in `src/lib/env.ts`), so email links return to the preview that sent them. |
| Email | Supabase's built-in mailer for now | Free and needs no setup, but limited (below). Configure custom SMTP before anyone outside your Supabase organization signs up. |
| Seed data | **Never** on staging | `supabase db push` does not run `seed.sql` unless `--include-seed` is passed. Don't pass it: the seed users share a published password. |

### Free-tier constraints to keep in mind

- **Supabase Free** projects pause after a period of inactivity and have database, storage and egress limits. Check the current numbers at <https://supabase.com/pricing> rather than relying on numbers written here. A paused project is restored from the dashboard.
- **Supabase's built-in email service** only delivers to members of the project's **organization** (Organization settings → Team). Other addresses fail with "Email address not authorized". It sends at most about **2 emails per hour**, best-effort. Sign-up, resend and password reset all count. For the first test, use the email address of your own Supabase account.
- **Vercel Hobby** is for personal, non-commercial use. Preview deployments are behind **Vercel Authentication** by default: only people logged in to your Vercel account can open them (see [Phone testing](#phone-test-checklist)).
- **Data API grants:** hosted projects no longer grant API roles access to new tables and functions automatically (Supabase changelog 45329; the default for new projects, and for all projects from 2026-10-30). SplitMate's migrations grant `authenticated` and `service_role` explicitly (`20261021131000_service_role_grants.sql`), so hosted and local behave the same. Every new table needs its own `GRANT`s in its migration.

## 1. Create the hosted Supabase project (you)

1. Sign in at <https://supabase.com/dashboard>. If you have no organization yet, create one on the **Free** plan.
2. Click **New project** and fill in:
   - **Organization:** yours.
   - **Project name:** `splitmate-staging`.
   - **Database password:** click **Generate a password** and save it in your password manager. You need it once, for `supabase link`. Never put it in the repo or in chat.
   - **Region:** the one closest to you and your testers, e.g. *South Asia (Mumbai)*. Remember it: the Vercel function region should match (step 5).
   - **Security / advanced options:** keep the Data API enabled. Leave **Automatically expose new tables** unchecked; the migrations grant access explicitly.
3. Click **Create new project** and wait until it shows as healthy (a minute or two).
4. Note these values:
   - **Project ref:** the 20-letter ID in the dashboard URL (`/project/<ref>`), also under **Project Settings → General**.
   - **Project URL:** `https://<ref>.supabase.co`.
   - **Publishable key:** **Project Settings → API Keys**. It starts with `sb_publishable_`. If the page only shows legacy `anon`/`service_role` keys, create the new API keys there first. Don't use the legacy JWT keys.
   - **Secret key:** not needed yet. The app has no server-side admin feature until M9, so don't copy it anywhere.

## 2. Link the project and push migrations

Run these from the repo folder. The Supabase CLI is a dev dependency (`npx supabase`, v2.121).

```bash
npx supabase login
```

This opens a browser to create an access token for the CLI. You do it; the token stays on your machine.

```bash
npx supabase link --project-ref <project-ref>
```

This asks for the database password from step 1; type or paste it at the prompt. It writes the link to `supabase/.temp/` (git-ignored).

```bash
npx supabase db push --linked --dry-run
```

This lists the migrations that would be applied, without changing anything. On a fresh project it should list all 11 files in `supabase/migrations/`.

```bash
npx supabase db push --linked
```

This applies them. Then check:

- **Database → Migrations** in the dashboard lists the same 11 versions.
- **Advisors → Security Advisor** and **Performance Advisor** show no new errors. The same checks run locally with `npx supabase db advisors --local`.
- **Storage** shows the private `receipts` bucket.

For later migrations, the routine is the same: `npm run db:reset` and `npm run db:test` locally, then `db push --linked --dry-run`, then `db push --linked`. Ask before every push (CLAUDE.md).

## 3. Configure Auth for staging (dashboard)

`supabase/config.toml` only configures the **local** stack. Don't use `supabase config push` for staging: it would copy local values such as the `localhost` Site URL. Set these in the dashboard instead.

### Email sign-in settings

Go to **Authentication → Sign In / Providers → Email**:

- **Confirm email:** on (the hosted default).
- **Secure email change:** on (the default).
- **Secure password change:** on. Matches local `secure_password_change = true`.
- **Minimum password length:** `8`. Matches local config and `MIN_PASSWORD_LENGTH` in `src/lib/validation/auth.ts`.
- Leave password requirements empty to match local.

Click **Save**.

### Email templates

The app verifies email links on the server with a token hash (`/auth/confirm`). The hosted default templates use `{{ .ConfirmationURL }}`, which does not work with that route, so replace two templates.

Go to **Authentication → Emails → Templates**:

**Confirm signup**
- Subject: `Confirm your SplitMate account`
- Body: paste the whole of [`supabase/templates/confirmation.html`](../supabase/templates/confirmation.html).

**Reset password**
- Subject: `Reset your SplitMate password`
- Body: paste the whole of [`supabase/templates/recovery.html`](../supabase/templates/recovery.html).

Save each one. Both build links as `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=…`.

### URL configuration

Go to **Authentication → URL Configuration**:

- **Redirect URLs:** add `https://*-<vercel-scope>.vercel.app/**`.
  - `<vercel-scope>` is the end of your preview hostnames, e.g. `sashas-projects` in `splitmate-abc123-sashas-projects.vercel.app`. It is also your team slug in Vercel dashboard URLs (`vercel.com/<scope>`).
  - `*` matches one hostname label without dots, which is exactly the `splitmate-<hash>` part.
- **Site URL:** set it after the first deployment to that preview's URL (step 6). It is only a fallback: if an email's redirect URL is not on the allow list, Auth uses the Site URL instead, and the link breaks.

## 4. Create and link the Vercel project (you, in the terminal)

```bash
npx vercel@65.0.0 login
```

Log in through the browser.

```bash
npx vercel@65.0.0 link
```

Answer the prompts:
- Pick your scope.
- **Link to existing project?** No.
- **Name:** `splitmate`.
- Accept the detected Next.js settings: don't customize. The build command is `next build`.

This creates `.vercel/project.json` (git-ignored). The CLI uploads this folder minus everything in [`.vercelignore`](../.vercelignore): no `.env*` files, tests, Supabase config or build output.

## 5. Project settings and environment variables (Vercel dashboard)

Open the project at <https://vercel.com/dashboard> → **splitmate** → **Settings**.

### Environment Variables

Add each variable with **only "Preview"** ticked:

| Key | Value | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | From step 1. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | From step 1. Safe in the browser: RLS protects the data. |

Do **not** add these:
- `NEXT_PUBLIC_APP_URL`: derived from the deployment URL on previews.
- `SUPABASE_SECRET_KEY`: nothing uses it yet, and it bypasses RLS.
- The optional `CRON_SECRET`, `EMAIL_*` and `EXCHANGE_RATE_API_KEY`.

Keep **Automatically expose System Environment Variables** on (the default). The build needs `VERCEL_ENV` and `VERCEL_URL`.

Environment variables are read at **build** time (`NEXT_PUBLIC_*` values are inlined), so redeploy after changing one.

### Build and runtime

- **Settings → Build and Deployment → Node.js Version:** `24.x`, which is what development uses (`package.json` allows ≥ 22).
- **Settings → Functions → Function Region:** the region closest to your Supabase region, e.g. Mumbai (`bom1`) for a Mumbai project. Each page makes several database round trips, so a distant region adds noticeable latency.
- **Settings → Deployment Protection:** leave **Vercel Authentication** on for previews. Testers then need your Vercel login or a share link; switch it off only if you accept that anyone with the URL can reach the staging app.

## 6. Deploy a preview

```bash
npx vercel@65.0.0 deploy
```

Without `--prod` this is a preview deployment. It uploads the folder, runs `npm install` and `next build` on Vercel, and prints the preview URL. A missing environment variable fails the build with a list of what to fix (`src/lib/env.ts`).

Then:

1. In Supabase **Authentication → URL Configuration**, set **Site URL** to this preview URL and save.
2. Open the URL on a computer and check that the landing page loads and that `/dashboard` redirects to `/login`.
3. **Deployments → (the deployment) → Logs** shows runtime errors. Users only ever see the generic error page.

Each later `vercel deploy` gets a new URL. The redirect wildcard already covers it; update the Site URL if you want the fallback to point at the newest preview.

## Phone test checklist

Use the email address of your Supabase account (built-in mailer, ≤ 2 emails/hour).

| # | Do | Expect |
| --- | --- | --- |
| 1 | Open the preview URL in your phone's main browser (Safari / Chrome), not an in-app browser. | Vercel login screen. Log in with your Vercel account; the SplitMate landing page loads. |
| 2 | Tap **Get started**. | Sign-up form, fields at least 44 px tall, email keyboard on the email field. |
| 3 | Enter your Supabase-account email and a new password of 8+ characters, then tap **Create account**. | **Check your email** page. |
| 4 | Open the "Confirm your SplitMate account" email on the phone. If the mail app opens links in its own browser, long-press the link, copy it, and paste it into the browser from step 1. | Lands on **Welcome to SplitMate** (onboarding). The link host is your preview URL, not `localhost`. |
| 5 | Check the name, pick a currency, tap **Continue**. | Dashboard: "Hi, <name>" and **No balances yet**. Bottom bar with Dashboard, Groups, ＋, Friends, Activity; only Dashboard is active, the others are dimmed (coming in M4–M6). |
| 6 | Check the edges of the screen. | Header clears the notch or status bar; bottom bar clears the home indicator; nothing is cut off in portrait. |
| 7 | Tap ☰ → **Dark**, then ☰ → **System**. | Theme switches immediately, and the choice is kept after a reload. |
| 8 | Tap ☰ → **Settings**. Change your name and **Save changes**. | "Profile saved." The new name shows on the dashboard. |
| 9 | Tap ☰ → **Log out**. | Login page. |
| 10 | Open `<preview-url>/dashboard` directly. | Redirected to **Log in**. After logging in, back on the dashboard. |
| 11 | Log in with a wrong password. | "Incorrect email or password." No other detail. |
| 12 | *(Optional, uses the 2nd email of the hour.)* Log out, tap **Forgot your password?**, request a link, open it in the same browser, set a new password, then log in with it. | "Your password has been updated." on Settings; the new password works. |
| 13 | In the Supabase dashboard: **Authentication → Users**, and **Table Editor → profiles**. | The user is confirmed; the profile has your name, currency and time zone, and `onboarded_at` is set. |

Report anything off with a screenshot and the step number.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Sign-up says "We can't send email to that address yet" | The address isn't in your Supabase organization (built-in mailer). | Use your Supabase-account email, invite the tester to the org, or set up custom SMTP (**Authentication → Emails → SMTP Settings**). |
| "Too many emails sent" | Built-in mailer limit (about 2/hour). | Wait an hour, or set up custom SMTP (starts at 30/hour, adjustable under **Authentication → Rate Limits**). |
| Email link points at `localhost:3000` or the Site URL | The preview URL isn't on the redirect allow list, so Auth fell back to the Site URL. | Check the `https://*-<vercel-scope>.vercel.app/**` entry (step 3). |
| Link opens `/login?error=link` ("invalid or has expired") | The token was already used (a mail scanner may have opened it), it expired (1 hour), or the template still uses `{{ .ConfirmationURL }}`. | Re-paste the templates (step 3); use **Resend confirmation email** on the login page. |
| Vercel "Authentication required" page | Deployment Protection. | Log in to Vercel in that browser, or open the link in the browser where you already did. |
| Build fails with "Invalid environment variables" | A Preview variable is missing or wrong. | Step 5, then redeploy. |
| Pages are slow | Function region far from the Supabase region, or the Free project is waking from a pause. | Match regions (step 5); restore the project in the Supabase dashboard if it's paused. |

## Later: production

When the MVP is ready (after M6, with approval):

- Create a separate Supabase project for production. Push migrations the same way, set up the same auth settings and templates, and use custom SMTP.
- In Vercel's **Production** environment, set `NEXT_PUBLIC_APP_URL` explicitly to the production domain. `resolveAppUrl` never derives it for production.
- Set the Supabase Site URL to the production domain, and list it exactly in Redirect URLs (no wildcard for production).
- Add `SUPABASE_SECRET_KEY` (Production, marked Sensitive) only when a server-only feature needs it (account deletion, M9).
- M7's recurring-expense job will need `pg_cron` enabled and scheduled on the hosted project.
- Never run `seed.sql`, `db reset` or tests against production.

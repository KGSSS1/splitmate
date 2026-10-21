# Deployment

SplitMate runs on **Supabase (Free)** for the database, auth and storage, and **Vercel (Hobby)** for the Next.js app (SPEC §19). This document covers **staging**: a hosted Supabase project plus Vercel deployments made from the CLI, reachable at one fixed URL. Production comes later (M9); see [Later: production](#later-production).

Dashboard labels change from time to time. If a menu item below has moved, use the dashboard's search box.

## What staging looks like

| Piece | Choice | Why |
| --- | --- | --- |
| Database / Auth | Separate hosted Supabase project, e.g. `splitmate-staging` | Staging data never mixes with production. |
| App | Vercel project `splitmate`, deployed with `npx vercel deploy` from this folder | The repo has no Git remote, so nothing deploys automatically. Every deploy is a deliberate step. |
| Stable URL | Alias `https://splitmate-staging-<scope>.vercel.app`, moved to each new deployment with `vercel alias set` | Branch URLs (`VERCEL_BRANCH_URL`) exist only for Git-integration deployments, so CLI deployments need an alias. With a fixed URL, the Supabase Site URL and redirect list are set once. |
| App URL | `NEXT_PUBLIC_APP_URL` = the alias, in Vercel's **Production** and **Preview** environments | Email links always go to the alias. If `NEXT_PUBLIC_APP_URL` were unset on a preview, `resolveAppUrl` (`src/lib/env.ts`) would fall back to `VERCEL_BRANCH_URL`, then `VERCEL_URL`. |
| Access | Vercel Authentication **off** for this project ([section 5](#deployment-protection-turning-off-vercel-authentication)) | Lets you test from your phone's Gmail app; SplitMate's own login protects the data. |
| Email | Supabase's built-in mailer for now | Free and needs no setup, but limited (below). Configure custom SMTP before anyone outside your Supabase organization signs up. |
| Seed data | **Never** on staging | `supabase db push` runs `seed.sql` only with `--include-seed`. Never pass it: the seed users share a published password. |

`<scope>` is your Vercel team or account slug: the last part of your deployment hostnames (for example `sashas-projects` in `splitmate-abc123-sashas-projects.vercel.app`), and also the segment after `vercel.com/` in dashboard URLs. Including it in the alias keeps the name unique across Vercel.

### Free-tier constraints to keep in mind

- **Supabase Free** projects pause after a period of inactivity and have database, storage and egress limits. Check the current numbers at <https://supabase.com/pricing> rather than trusting numbers written here. A paused project is restored from the dashboard.
- **Supabase's built-in email service** only delivers to members of the project's **organization** (Organization settings → Team). Other addresses get the app's "We can't send email to that address yet" message. It sends at most about **2 emails per hour**, best-effort. Sign-up, resend and password reset all count. For the first test, use the email address of your own Supabase account.
- **Vercel Hobby** is for personal, non-commercial use. A new project's **first deployment is always a production deployment**, even without `--prod`. That is why the variables in step 5 go into both Production and Preview.
- **Data API grants:** hosted projects no longer grant API roles access to new tables and functions automatically (Supabase changelog 45329; the default for new projects, and for all projects from 2026-10-30). SplitMate's migrations grant `authenticated` and `service_role` explicitly (`20261021131000_service_role_grants.sql`), so hosted and local behave the same. Every new table needs its own `GRANT`s in its migration.

## 1. Create the hosted Supabase project (you)

1. Sign in at <https://supabase.com/dashboard>. If you have no organization yet, create one on the **Free** plan.
2. Click **New project** and fill in:
   - **Organization:** yours.
   - **Project name:** `splitmate-staging`.
   - **Database password:** click **Generate a password** and save it in your password manager. You need it once, for `supabase link`. Never put it in the repo or in chat.
   - **Region:** the one closest to you and your testers, e.g. *South Asia (Mumbai)*. Note it: the Vercel function region should match (step 5).
   - **Security / advanced options:** keep the Data API enabled. Leave **Automatically expose new tables** unchecked; the migrations grant access explicitly.
3. Click **Create new project** and wait until it shows as healthy (a minute or two).
4. Note these values:
   - **Project ref:** the 20-letter ID in the dashboard URL (`/project/<ref>`), also under **Project Settings → General**.
   - **Project URL:** `https://<ref>.supabase.co`.
   - **Publishable key:** **Project Settings → API Keys**. It starts with `sb_publishable_`. If the page only shows legacy `anon`/`service_role` keys, create the new API keys there first. Don't use the legacy JWT keys.
   - **Secret key:** not needed yet. Nothing in the app uses admin access until M9, so don't copy it anywhere.

## 2. Link the project and push migrations

Run these from the repo folder. The Supabase CLI is a dev dependency (`npx supabase`, v2.121).

1. Log the CLI in to Supabase. This opens a browser to create an access token, which stays on your machine:

   ```bash
   npx supabase login
   ```

2. Link the folder to the project. You type the database password from step 1 at the prompt; the link is stored in `supabase/.temp/` (git-ignored):

   ```bash
   npx supabase link --project-ref <project-ref>
   ```

3. Preview what would be applied, without changing anything. On a fresh project it lists all 11 files in `supabase/migrations/`:

   ```bash
   npx supabase db push --linked --dry-run
   ```

4. Apply them:

   ```bash
   npx supabase db push --linked
   ```

Then check in the dashboard:

- **Database → Migrations** lists the same 11 versions.
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

Save each one. Both build links as `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=…`, and the app sets `RedirectTo` to `<NEXT_PUBLIC_APP_URL>/auth/confirm`.

### URL configuration

Go to **Authentication → URL Configuration**. Set these once; they don't change between deployments.

- **Site URL:** `https://splitmate-staging-<scope>.vercel.app`, the alias. Auth falls back to it whenever a redirect URL is not allowed.
- **Redirect URLs:** add both:
  - `https://splitmate-staging-<scope>.vercel.app/**`: the alias, which is where every email link points.
  - `https://*-<scope>.vercel.app/**`: a wildcard for your other Vercel hostnames (per-deployment URLs, and branch URLs if Git integration is connected later). `*` matches one hostname label without dots, so it covers `splitmate-abc123-<scope>` and `splitmate-git-staging-<scope>`, but nothing outside your scope.

## 4. Create and link the Vercel project (you, in the terminal)

1. Log the Vercel CLI in through the browser:

   ```bash
   npx vercel@65.0.0 login
   ```

2. Link this folder to a new project:

   ```bash
   npx vercel@65.0.0 link
   ```

   Answer the prompts:
   - Pick your scope, and note its slug for `<scope>`.
   - **Link to existing project?** No.
   - **Name:** `splitmate`.
   - Accept the detected Next.js settings: don't customize. The build command is `next build`.

This creates `.vercel/project.json` (git-ignored). Deployments upload this folder minus everything in [`.vercelignore`](../.vercelignore): no `.env*` files, tests, Supabase config or build output.

## 5. Project settings (Vercel dashboard)

Open the project at <https://vercel.com/dashboard> → **splitmate** → **Settings**.

### Environment Variables

Add each variable with both **Production** and **Preview** ticked:

| Key | Value | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | From step 1. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | From step 1. Safe in the browser: RLS and server checks protect the data. |
| `NEXT_PUBLIC_APP_URL` | `https://splitmate-staging-<scope>.vercel.app` | The alias, with no trailing slash. |

Why both environments: Vercel makes the project's first deployment a production deployment, and until the real production launch (M9) this project serves staging only. At launch, the Production values change; see [Later: production](#later-production).

Do **not** add these:
- `SUPABASE_SECRET_KEY`: nothing uses it yet, and it bypasses RLS.
- The optional `CRON_SECRET`, `EMAIL_*` and `EXCHANGE_RATE_API_KEY`.

These are read at **build** time (`NEXT_PUBLIC_*` values are inlined), so redeploy after changing one.

### Build and runtime

- **Settings → Build and Deployment → Node.js Version:** `24.x`, matching `"engines": { "node": "24.x" }` in `package.json` (Vercel reads that field too and warns on a mismatch).
- **Settings → Functions → Function Region:** the region closest to your Supabase region, e.g. Mumbai (`bom1`) for a Mumbai project. Each page makes several database round trips, so a distant region adds noticeable latency.

### Deployment Protection: turning off Vercel Authentication

New Vercel projects use **Standard Protection** with **Vercel Authentication**. Every URL except production domains, including preview deployments and aliases like ours, first shows a Vercel login page. That breaks the phone test: the confirmation link opens in the Gmail app's built-in browser, which isn't logged in to Vercel, so you'd see Vercel's login instead of SplitMate.

**To turn it off:** go to **Settings → Deployment Protection**, switch **Vercel Authentication** to **Disabled**, and click **Save**. It applies immediately to existing and new deployments. Password protection, the alternative, isn't available on Hobby.

**What you gain:**
- Links from email work in any browser, including the Gmail app's, with no Vercel account needed.
- Friends can open staging later without being added to your Vercel team.

**What you give up:** anyone who has or guesses the URL can load the staging app. Only the app's own security then stands in the way, which is the same position production will be in. In practice:
- **Data stays protected.** Every page and Server Action checks the session on the server, and RLS checks it again in the database. Without an account, a visitor sees only the landing, sign-up and login pages.
- **Strangers can still create accounts.** With the built-in mailer they can't confirm them (it only emails your organization's members), but they can make requests that count against Supabase's auth rate limits and free-tier quotas.
- **Unfinished work is visible.** Staging runs code before it's fully reviewed, so its bugs and unreleased features are visible too. Preview URLs aren't indexed by search engines (Vercel sends `noindex`), but don't rely on obscurity.
- **No second gate.** If a bug ever exposed data, nothing in front of the app would catch it.

**Keep the risk small:**
- Put only test data in staging, never real expenses or real people's details.
- Keep staging and production in separate Supabase projects (step 1).
- Turn Vercel Authentication back on when you aren't actively testing. It's the same toggle, and you then need to be logged in to Vercel in the browser you test from.

## 6. Deploy and point the alias at it

1. Create the deployment:

   ```bash
   npx vercel@65.0.0 deploy
   ```

   This uploads the folder, runs `npm install` and `next build` on Vercel, and prints the new deployment URL on stdout. The very first run creates a **production** deployment (see above); later runs create previews. A missing environment variable fails the build with a list of what to fix (`src/lib/env.ts`).

2. Point the fixed name at that deployment. Run it after **every** deploy, including the first:

   ```bash
   npx vercel@65.0.0 alias set <deployment-url> splitmate-staging-<scope>.vercel.app
   ```

3. Open `https://splitmate-staging-<scope>.vercel.app` on a computer. Check that the landing page loads and that `/dashboard` redirects to `/login`.
4. Runtime errors show under **Deployments → (the deployment) → Logs**. Users only ever see the generic error page.

To go back to an earlier version, run `alias set` with that deployment's URL (listed under **Deployments**).

## Phone test checklist

Use the email address of your Supabase account (built-in mailer, ≤ 2 emails/hour). Vercel Authentication must be off (step 5). All steps use the alias URL.

| # | Do | Expect |
| --- | --- | --- |
| 1 | Open the alias URL on your phone. | SplitMate landing page, with no Vercel login. |
| 2 | Tap **Get started**. | Sign-up form, fields at least 44 px tall, email keyboard on the email field. |
| 3 | Enter your Supabase-account email and a new password of 8+ characters, then tap **Create account**. | **Check your email** page. |
| 4 | In the **Gmail app**, open "Confirm your SplitMate account" and tap **Confirm my email**. | Gmail's built-in browser opens **Welcome to SplitMate** (onboarding). The address bar shows the alias, not `localhost`. You're now logged in *in that browser*. |
| 5 | Check the name, pick a currency, tap **Continue**. | Dashboard: "Hi, <name>" and **No balances yet**. Bottom bar with Dashboard, Groups, ＋, Friends, Activity; only Dashboard is active, the others are dimmed (coming in M4–M6). |
| 6 | Switch to your phone's main browser, open the alias URL, and log in with the same email and password. | Dashboard, as above. (Gmail's built-in browser and your main browser keep separate sessions; that's expected.) |
| 7 | Check the edges of the screen. | Header clears the notch or status bar; bottom bar clears the home indicator; nothing is cut off in portrait. |
| 8 | Tap ☰ → **Dark**, then ☰ → **System**. | Theme switches immediately, and the choice is kept after a reload. |
| 9 | Tap ☰ → **Settings**. Change your name and **Save changes**. | "Profile saved." The new name shows on the dashboard. |
| 10 | Tap ☰ → **Log out**. | Login page. |
| 11 | Open `<alias>/dashboard` directly. | Redirected to **Log in**. After logging in, back on the dashboard. |
| 12 | Log in with a wrong password. | "Incorrect email or password." No other detail. |
| 13 | *(Optional, uses the 2nd email of the hour.)* Log out, tap **Forgot your password?** and request a link. Open it from Gmail, set a new password, then log in with it in the main browser. | "Your password has been updated." on Settings; the new password works. |
| 14 | In the Supabase dashboard: **Authentication → Users**, and **Table Editor → profiles**. | The user is confirmed; the profile has your name, currency and time zone, and `onboarded_at` is set. |

Report anything off with a screenshot and the step number.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Sign-up says "We can't send email to that address yet" | The address isn't in your Supabase organization (built-in mailer). | Use your Supabase-account email, invite the tester to the org, or set up custom SMTP (**Authentication → Emails → SMTP Settings**). |
| "Too many emails sent" | Built-in mailer limit (about 2/hour). | Wait an hour, or set up custom SMTP (starts at 30/hour, adjustable under **Authentication → Rate Limits**). |
| Email link points at `localhost` or a different host | `NEXT_PUBLIC_APP_URL` is wrong for that deployment, or the redirect URL isn't allowed and Auth fell back to the Site URL. | Check the Vercel variables (step 5; redeploy after changes) and the Supabase URL configuration (step 3). |
| Link opens `/login?error=link` ("invalid or has expired") | The token was already used, it expired (1 hour), a mail scanner opened it first, or the template still uses `{{ .ConfirmationURL }}`. | Re-paste the templates (step 3); use **Resend confirmation email** on the login page. |
| Alias shows an old version | `alias set` wasn't run after the latest deploy. | Run step 6.2 with the new deployment URL. |
| "The chosen alias … is already in use" | The name is taken. Aliases are global across Vercel. | Pick another name, then update `NEXT_PUBLIC_APP_URL`, the Site URL and the exact redirect URL to match. |
| Vercel "Authentication required" page | Deployment Protection is still on. | Step 5, Deployment Protection. |
| Build fails with "Invalid environment variables" | A variable is missing for that environment (Production or Preview). | Step 5, then redeploy. |
| Pages are slow | Function region far from the Supabase region, or the Free project is waking from a pause. | Match regions (step 5); restore the project in the Supabase dashboard if it's paused. |

## Later: production

When the MVP is ready (after M6, with approval):

- Create a separate Supabase project for production. Push migrations the same way, set up the same auth settings and templates, and use custom SMTP.
- In Vercel's **Production** environment, change the three variables to the production Supabase project and production domain. Keep Preview pointing at staging. From then on, staging is deployed only as previews (no `--prod`), with the alias moved as above.
- Set the production Supabase Site URL to the production domain, and list it exactly in Redirect URLs (no wildcard for production).
- Decide Deployment Protection for previews again. With real users in production, previews can go back behind Vercel Authentication, which never covers production domains.
- Add `SUPABASE_SECRET_KEY` (Production, marked Sensitive) only when a server-only feature needs it (account deletion, M9).
- M7's recurring-expense job will need `pg_cron` enabled and scheduled on the hosted project.
- Never run `seed.sql`, `db reset` or tests against production.

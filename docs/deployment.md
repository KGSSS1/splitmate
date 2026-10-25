# Deployment

SplitMate runs on **Supabase (Free)** for the database, auth and storage, and **Vercel (Hobby)** for the Next.js app (SPEC §19). Vercel deploys from GitHub through its Git integration:

| Branch | Vercel environment | URL |
| --- | --- | --- |
| `staging` | Preview (staging) | `https://splitmate-git-staging-kgsss1s-projects.vercel.app` (stable; it always shows the latest `staging` push) |
| `main` | Production | Its production domain, set explicitly (see [Production](#production-main)) |
| any other branch | Preview | `https://splitmate-git-<branch>-kgsss1s-projects.vercel.app` |

- **GitHub repo:** `KGSSS1/splitmate`. It is **public**: never commit secrets, real data or `.env*` files. `.env.example` is the only env file in Git.
- **Vercel project:** `splitmate`, in scope `kgsss1s-projects`.

Dashboard labels change from time to time. If a menu item below has moved, use the dashboard's search box.

## How the app URL is chosen

Email links (sign-up confirmation, password reset) are built from `NEXT_PUBLIC_APP_URL`. `next.config.ts` resolves it at build time with `resolveAppUrl` (`src/lib/env.ts`):

| Where | `NEXT_PUBLIC_APP_URL` |
| --- | --- |
| Local | From `.env.local`, e.g. `http://localhost:3000` |
| Vercel **Preview** | Leave **unset**. The build uses `VERCEL_BRANCH_URL` (the stable branch URL above), falling back to `VERCEL_URL` (the one-off deployment URL). Each branch's emails therefore link back to that branch's own preview. |
| Vercel **Production** | **Required**, set explicitly to the production URL. It is never derived; without it the build fails with "NEXT_PUBLIC_APP_URL is missing: Vercel Production must set it explicitly". |

An explicit value always wins, so **don't** add `NEXT_PUBLIC_APP_URL` to the Preview environment. It would point every branch's emails at one URL.

## Free-tier constraints to keep in mind

- **Supabase Free:** projects pause after a period of inactivity and have database, storage and egress limits. Check the current numbers at <https://supabase.com/pricing> rather than trusting numbers written here. A paused project is restored from the dashboard.
- **Supabase's built-in email service:**
  - It only delivers to members of the project's **organization** (Organization settings → Team). Other addresses get the app's "We can't send email to that address yet" message.
  - It sends at most about **2 emails per hour**, best-effort. Sign-up, resend and password reset all count.
  - For testing, use the email address of your own Supabase account. Configure custom SMTP before anyone else signs up.
- **Vercel Hobby:** for personal, non-commercial use. Every push to any branch builds a deployment and counts toward build usage.
- **Data API grants:** hosted projects no longer grant API roles access to new tables and functions automatically (Supabase changelog 45329; the default for new projects, and for all projects from 2026-10-30). SplitMate's migrations grant `authenticated` and `service_role` explicitly (`20261021131000_service_role_grants.sql`), so hosted and local behave the same. Every new table needs its own `GRANT`s in its migration.

## 1. Create the hosted Supabase staging project

1. Sign in at <https://supabase.com/dashboard>. If you have no organization yet, create one on the **Free** plan.
2. Click **New project** and fill in:
   - **Organization:** yours.
   - **Project name:** `splitmate-staging`.
   - **Database password:** click **Generate a password** and save it in your password manager. You need it once, for `supabase link`. Never put it in the repo or in chat.
   - **Region:** the one closest to you and your testers, e.g. *South Asia (Mumbai)*. The Vercel function region should match (step 4).
   - **Security / advanced options:** keep the Data API enabled. Leave **Automatically expose new tables** unchecked; the migrations grant access explicitly.
3. Click **Create new project** and wait until it shows as healthy.
4. Note these values:
   - **Project ref:** the 20-letter ID in the dashboard URL (`/project/<ref>`), also under **Project Settings → General**.
   - **Project URL:** `https://<ref>.supabase.co`.
   - **Publishable key:** **Project Settings → API Keys**. It starts with `sb_publishable_`. If only legacy `anon`/`service_role` keys are shown, create the new API keys there first. Don't use the legacy JWT keys.
   - **Secret key:** the app never needs it (account deletion and exchange rates run inside the database). You only use the **staging** secret key locally for the E2E-against-staging run ([below](#e2e-tests-against-staging)).

## 2. Link the project and push migrations

Run these from the repo folder. The Supabase CLI is a dev dependency (`npx supabase`, v2.121).

1. Create a CLI access token in the browser. It stays on your machine:

   ```bash
   npx supabase login
   ```

2. Link this folder to the project. You type the database password at the prompt; the link is stored in `supabase/.temp/` (git-ignored):

   ```bash
   npx supabase link --project-ref <project-ref>
   ```

3. Preview the push. This changes nothing; on a fresh project it lists every migration:

   ```bash
   npx supabase db push --linked --dry-run
   ```

4. Apply the migrations:

   ```bash
   npx supabase db push --linked
   ```

Then check in the dashboard:

- **Database → Migrations** lists the same versions as `supabase/migrations/`.
- **Advisors** — `npx supabase db advisors --linked --type all --level warn`, or **Advisors → Security / Performance Advisor** in the dashboard — show no errors. The expected warnings are:
  - **29 × WARN `authenticated_security_definer_function_executable`** (rule 0029) after M9: one per SECURITY DEFINER public RPC (the list in `docs/api.md`), including M9's `delete_my_account`. This is intended: those RPCs are SECURITY DEFINER on purpose and check `auth.uid()` themselves. The SECURITY INVOKER reads (`search_expenses`, `my_expense_shares`, `latest_exchange_rates`, …) aren't flagged. A new function in this list needs a review. The local CLI's advisor doesn't flag these, so the hosted run is the one to check.
  - **WARN `auth_leaked_password_protection`**: a hosted Auth setting (check new passwords against known leaks), not a migration. Turn it on under **Authentication → Attack Protection** if your plan offers it.
  - **INFO `unused_index`**: expected on a database that has served few or no queries. Revisit it once staging has real traffic.
- `npx supabase db lint --linked --level warning` reports no issues.
- **Storage** shows the private `receipts` bucket.

`db push` runs `seed.sql` only with `--include-seed`. **Never** seed a hosted project: the seed users share a published password.

For later migrations, the routine is the same: `npm run db:reset` and `npm run db:test` locally, then `db push --linked --dry-run`, then `db push --linked`. Ask before every push (CLAUDE.md).

## 3. Configure Auth for staging (Supabase dashboard)

`supabase/config.toml` only configures the **local** stack. Don't use `supabase config push`: it would copy local values such as the `localhost` Site URL. Set these in the dashboard instead.

### Email sign-in settings

Go to **Authentication → Sign In / Providers → Email**:

- **Confirm email:** on (the hosted default).
- **Secure email change:** on (the default).
- **Secure password change:** on. Matches local `secure_password_change = true`.
- **Minimum password length:** `8`. Matches local config and `MIN_PASSWORD_LENGTH` in `src/lib/validation/auth.ts`.
- Leave password requirements empty to match local.

Click **Save**.

### Custom SMTP (Brevo)

Supabase's built-in mailer only emails members of your Supabase organization, at about 2 emails an hour. Friends need custom SMTP to receive confirmation emails. These steps use Brevo's free plan; any SMTP provider works the same way (Supabase also lists Resend, Postmark, AWS SES, SendGrid and ZeptoMail). Credentials go into the dashboards only: never into the repo, `.env*` files or chat.

**1. Brevo: account and sender**

1. Create a free account at <https://www.brevo.com>. Check the current free daily limit on their pricing page.
2. Go to **Senders, Domains & Dedicated IPs → Senders → Add a sender**. Use a name like `SplitMate (staging)` and an address you can open. Brevo emails it a code; enter it to verify the sender.
3. *(Better, if you own a domain)* **Domains → Add a domain**, then add the DKIM/DMARC DNS records it shows. A From address on a free-mail domain such as `gmail.com`, sent through a third party, is more likely to land in spam or be rejected, because Brevo can't sign for that domain.

**2. Brevo: SMTP key**

1. Go to **SMTP & API → SMTP** (account menu, top right).
2. Note the **SMTP server** (`smtp-relay.brevo.com`), **Port** (`587`) and **Login** (an address Brevo assigns, often ending in `@smtp-brevo.com`; it is not necessarily your account email).
3. Click **Generate a new SMTP key**, name it `supabase-splitmate-staging`, and copy it. Brevo shows it only once. Use an **SMTP key**, not an API key.

**3. Supabase: enable custom SMTP**

In the `splitmate-staging` project, go to **Authentication → Emails → SMTP Settings** (direct link: `https://supabase.com/dashboard/project/vnjktzhyvfbnyfzppnkw/auth/smtp`) and turn on **Enable custom SMTP**:

| Field | Value |
| --- | --- |
| Sender email | The address you verified in Brevo |
| Sender name | `SplitMate` |
| Host | `smtp-relay.brevo.com` |
| Port number | `587` |
| Username | The Brevo SMTP **Login** |
| Password | The SMTP key |
| Minimum interval between emails | Keep the default |

Click **Save**.

**4. Supabase: rate limit**

After saving, Supabase limits auth emails to 30 per hour. **Authentication → Rate Limits** changes it. 30 is plenty for a handful of testers; raise it only if people hit "try again later" while signing up.

**5. Switch to the custom templates** (see the next section). With custom SMTP the templates become editable, and the token-hash links work in any browser, including the Gmail app's.

**6. Test it**

1. Sign up on the staging URL with an address that is **not** in your Supabase organization (a second address of yours).
2. The email should arrive within a minute, from your sender name, and its link should open the staging URL.
3. If it doesn't arrive: check spam, then Brevo's **Transactional → Logs** (or **Statistics**), then Supabase's **Logs → Auth** for SMTP errors (wrong login or key, unverified sender).

To undo it, turn **Enable custom SMTP** off; Supabase goes back to the built-in mailer.

### Email templates (optional until custom SMTP)

Supabase only lets you edit email templates once custom SMTP is configured. Until then the hosted project uses its **default templates**, and the app works with them. `/auth/confirm` accepts both link styles:

| Link style | Comes from | How it works | Works in any browser? |
| --- | --- | --- | --- |
| `?code=…` | Default templates (`{{ .ConfirmationURL }}`) | The link opens Supabase's `/auth/v1/verify`, which confirms the email (or authorizes the reset) and redirects to `<NEXT_PUBLIC_APP_URL>/auth/confirm?code=…`. The app exchanges the code for a session (PKCE). | **No.** The exchange needs the code-verifier cookie stored in the browser that signed up or requested the reset. |
| `?token_hash=…&type=…` | Custom templates (`supabase/templates/*.html`) | The app shows a **Continue** page; pressing it verifies the token on the server (`verifyOtp`). Opening the link alone uses nothing, so mail scanners can't spend it (review M9 L3). | Yes |

With the default templates:

- **Same browser** (link opened where you signed up or requested the reset): sign-up goes to onboarding and a reset goes to **Choose a new password**, already logged in.
- **Different browser:** the login page says the link was opened in a different browser.
  - **Sign-up:** the email *is* confirmed by then, so logging in works.
  - **Password reset:** request a new link and open it in the browser you requested it from.
- **Expired or used link:** "That link is invalid or has expired." Supabase reports these in the URL fragment (`#error=…`), which the app's server never receives. Such a request carries no code, so the same message appears.

**After custom SMTP is set up**, switch to the custom templates so links work in any browser. Go to **Authentication → Emails → Templates**:

- **Confirm signup:**
  - Subject: `Confirm your SplitMate account`
  - Body: paste the whole of [`supabase/templates/confirmation.html`](../supabase/templates/confirmation.html).
- **Reset password:**
  - Subject: `Reset your SplitMate password`
  - Body: paste the whole of [`supabase/templates/recovery.html`](../supabase/templates/recovery.html).

Both build links as `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=…`. The app sets `RedirectTo` to `<NEXT_PUBLIC_APP_URL>/auth/confirm`. No app change is needed when you switch, because both link styles keep working.

Tests:
- **Local Supabase** uses the custom templates (`supabase/config.toml`); `tests/e2e/auth.spec.ts` covers them.
- **Default-template links** are covered by `tests/e2e/default-email-links.spec.ts`, which builds the default-style `/auth/v1/verify` link from the same email: same browser, other browser, password reset and a reused link.
- **Every route branch** is covered by `tests/unit/auth/confirm-route.test.ts`.

### URL configuration

Go to **Authentication → URL Configuration** and set:

- **Site URL:** `https://splitmate-git-staging-kgsss1s-projects.vercel.app`
- **Redirect URLs** (add both):
  - `https://splitmate-git-staging-kgsss1s-projects.vercel.app/**` — the staging branch URL. All `staging` email links point here.
  - `https://*-kgsss1s-projects.vercel.app/**` — every other preview in your Vercel scope: other branches' URLs (`splitmate-git-<branch>-kgsss1s-projects`) and one-off deployment URLs. `*` matches one hostname label without dots, so it can't match hosts outside `kgsss1s-projects`.

The Site URL is the fallback: if an email's redirect URL isn't on the list, Auth uses the Site URL instead. Because the staging branch URL never changes, none of these need updating after a deploy.

The production URL does **not** go here. Production gets its own Supabase project (see [Later: production](#later-production)).

## 4. Vercel project settings

The project is already connected to `KGSSS1/splitmate`. Open <https://vercel.com/kgsss1s-projects/splitmate> → **Settings**.

### Git

- **Settings → Git → Production Branch:** `main`. Every other branch, including `staging`, deploys as a preview.

### Environment Variables

**Settings → Environment Variables**:

| Key | Preview (staging) | Production (`main`) |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<staging-ref>.supabase.co` (the API URL from Project Settings → Data API, **not** the dashboard address `supabase.com/dashboard/project/…`; the build now rejects that) | The production project's URL (at launch) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Staging `sb_publishable_…` | The production project's key (at launch) |
| `NEXT_PUBLIC_APP_URL` | **Leave unset** (derived from the branch URL) | **Required**: the production URL, with no trailing slash |

Both Supabase variables currently exist for Production and Preview with the same value. Set them per environment if the values differ.

Don't add these:
- `SUPABASE_SECRET_KEY`: the app doesn't use it (account deletion and exchange rates run in the database), and it bypasses RLS.
- The optional `CRON_SECRET`, `EMAIL_*` and `EXCHANGE_RATE_API_KEY`.

Variables are read at **build** time (`NEXT_PUBLIC_*` values are inlined into the bundle), so after changing one you must redeploy: **Deployments → ⋯ → Redeploy** on the latest deployment of that branch, or push a new commit.

### Build and runtime

- **Settings → Build and Deployment → Node.js Version:** `24.x`, matching `"engines": { "node": "24.x" }` in `package.json`. Vercel also reads the `engines` field.
- **Settings → Functions → Function Region:** the region closest to your Supabase project, e.g. Mumbai (`bom1`) for a Mumbai project. It is currently Washington, D.C. (`iad1`), the default. Each page makes several database round trips, so a distant region adds noticeable latency.
- **`.vercelignore`:** Git deployments honour it too. Every pattern is anchored at the repo root (`/supabase/`, `/tests/`, …), so nothing under `src/` is ever dropped. `tests/unit/vercelignore.test.ts` guards this.

### Deployment Protection: turning off Vercel Authentication

New Vercel projects use **Standard Protection** with **Vercel Authentication**: every URL except production domains, including the staging branch URL, first shows a Vercel login page. The staging URL is currently protected this way.

That breaks phone testing. The confirmation link opens in the Gmail app's built-in browser, which isn't logged in to Vercel, so you'd see Vercel's login instead of SplitMate.

**To turn it off:** **Settings → Deployment Protection**, set **Vercel Authentication** to **Disabled**, then **Save**. It applies at once to existing and new deployments. Password protection, the alternative, isn't available on Hobby.

**What you gain:**
- Email links work in any browser, including the Gmail app's, without a Vercel account.
- Friends can open staging later without joining your Vercel team.

**What you give up:** anyone who has or guesses a preview URL can load it. Only the app's own security then stands in the way, which is the same position production will be in. Specifically:
- **Your data stays protected.** Every page and Server Action checks the session on the server, and RLS checks it again in the database. Without an account, a visitor sees only the landing, sign-up and login pages.
- **Strangers can still create accounts.** With the built-in mailer they can't confirm them (it only emails your organization's members), but their requests count against Supabase's auth rate limits and free-tier quotas.
- **Unfinished work is visible.** Every branch preview, including half-finished feature branches, is reachable too. Preview URLs aren't indexed by search engines (Vercel sends `noindex`), and the branch URLs are predictable from the public repo's branch names.
- **There's no second gate.** If a bug ever exposed data, nothing in front of the app would catch it.

**Keep the risk small:**
- Put only test data in staging: never real expenses or real people's details.
- Keep staging and production in separate Supabase projects.
- Turn Vercel Authentication back on when you aren't actively testing. It's the same toggle; you then need to be logged in to Vercel in the browser you test from.

## 5. Deploying

**Staging:** push to `staging`:

```bash
git push origin staging
```

Vercel builds it as a preview and moves `https://splitmate-git-staging-kgsss1s-projects.vercel.app` to the new deployment. Progress and logs are in the Vercel dashboard (**Deployments**), and the result shows as the **Vercel** status check on the commit in GitHub. A missing environment variable fails the build with a list of what to fix (`src/lib/env.ts`).

**Feature branches:** pushing any other branch creates its own preview at `splitmate-git-<branch>-kgsss1s-projects.vercel.app`, which uses the same staging Supabase project. Sign-up emails from a feature branch link back to that branch, which the wildcard redirect URL allows.

**Production:** see [Production (`main`)](#production-main) below. Push `main` only as step P5, with approval.

After each staging deploy:

1. Open the staging URL. Check that the landing page loads and that `/dashboard` redirects to `/login`.
2. If something fails, open **Deployments → (the deployment) → Logs**. Users only ever see the generic error page.

To roll staging back, click **Redeploy** on an earlier deployment of `staging`, or revert the commit and push.

## Production (`main`)

Production is a **separate Supabase project** and the Vercel **Production** environment, deployed by pushing `main`. Staging data never touches it, and nothing from `supabase/seed.sql` or the tests ever runs against it. Each step below needs the owner's go-ahead (CLAUDE.md).

### P1. Create the production Supabase project

1. **New project** in your organization: name `splitmate-prod`, a generated database password (keep it in your password manager), and the same region as staging. Keep the Data API on and leave "Automatically expose new tables" off.
2. Note its **project ref**, **API URL** (`https://<prod-ref>.supabase.co`) and **publishable key** (`sb_publishable_…`). The app doesn't need the secret key: account deletion and exchange rates run inside the database.

### P2. Push the migrations

The CLI is linked to one project at a time; the link lives in `supabase/.temp/` (git-ignored).

```bash
npx supabase link --project-ref <prod-ref>
```

```bash
npx supabase db push --linked --dry-run
```

The dry run must list every file in `supabase/migrations/` and **no seed**. Then:

```bash
npx supabase db push --linked
```

The migrations enable `pg_cron` and `pg_net` and schedule three jobs: hourly recurring expenses, and the daily exchange-rate request and collect. Check:

```bash
npx supabase db lint --linked --level warning
```

```bash
npx supabase db advisors --linked --type all --level warn
```

Expect no errors and the same rule-0029 warnings as staging (section 2), nothing else. Then link back to staging so later commands don't hit production by accident:

```bash
npx supabase link --project-ref <staging-ref>
```

### P3. Auth settings (production dashboard)

Same as section 3, with production values:

- **Email:** Confirm email on, Secure email change on, Secure password change on, minimum password length 8.
- **Custom SMTP:** required before real users sign up (the built-in mailer only emails your organization). Use a verified sender, ideally on your own domain.
- **Email templates:** paste `supabase/templates/confirmation.html` and `recovery.html` (subjects as in section 3). Links then work in any browser and land on the **Continue** page.
- **URL Configuration:** Site URL = the production URL; Redirect URLs = exactly `<production URL>/**`, with no preview wildcard.
- **Rate limits:** leave the defaults unless real use needs more.

### P4. Vercel Production environment

**Settings → Environment Variables**, scope **Production** only:

| Key | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<prod-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the production `sb_publishable_…` |
| `NEXT_PUBLIC_APP_URL` | the production URL, e.g. `https://splitmate-kgsss1s-projects.vercel.app` or your domain, with no trailing slash |

Make sure the Preview scope keeps the **staging** values; the variables currently share one value across both environments. Don't add `SUPABASE_SECRET_KEY`.

### P5. Deploy

Merge the tested `staging` into `main` and push:

```bash
git checkout main
```

```bash
git merge --ff-only staging
```

```bash
git push origin main
```

```bash
git checkout staging
```

Vercel builds the production deployment. A missing variable fails the build with a clear list (`src/lib/env.ts`).

### P6. Smoke test (production)

Use a real address of your own; don't create test data with fake people.

1. `/` loads, and `/dashboard` redirects to `/login`. The response headers include HSTS, `X-Frame-Options: DENY`, `nosniff` and `Referrer-Policy`, and no `X-Powered-By`.
2. `/manifest.webmanifest` and `/sw.js` load; `/sw.js` is `no-store`.
3. Sign up, open the confirmation email (it must point at the production URL), press **Continue**, onboard.
4. Create a group, add an expense, check the dashboard, then cancel the expense.
5. Settings → **Download everything (JSON)** contains your profile.
6. The next day, the dashboard shows an approximate total if you have balances in two currencies, or check `exchange_rates` in the dashboard after 15:25 UTC.
7. *(Optional)* Delete the account from Settings once your balances are zero.

Rollback: **Deployments → (an earlier production deployment) → ⋯ → Promote**, or revert on `main` and push. Database migrations aren't rolled back automatically. Write a new migration instead.

## Phone test checklist

Do this after section 4's Deployment Protection change. Use the email address of your Supabase account (built-in mailer, ≤ 2 emails/hour). Every step uses `https://splitmate-git-staging-kgsss1s-projects.vercel.app`.

| # | Do | Expect |
| --- | --- | --- |
| 1 | Open the staging URL on your phone. | SplitMate landing page, with no Vercel login. |
| 2 | Tap **Get started**. | Sign-up form; fields at least 44 px tall; email keyboard on the email field. |
| 3 | Enter your Supabase-account email and a new password (8+ characters), then tap **Create account**. | **Check your email** page. |
| 4 | In the **Gmail app**, open the confirmation email (Supabase's default "Confirm Your Signup" until custom templates are set up) and tap the link. | The address bar shows the staging URL, not `localhost`, and one of two things happens, both correct with the default templates (see section 3):<br>• **Same cookies as the browser you signed up in.** On Android, Gmail opens links in Chrome tabs that share Chrome's cookies, so this happens if you signed up in Chrome. You land on **Welcome to SplitMate** (onboarding), logged in.<br>• **Separate browser.** This is the case for Gmail's built-in browser on iOS. The login page says the link was opened in a different browser; your email is confirmed. |
| 5 | If you saw the different-browser message, log in on that page with the same email and password. Then check the name, pick a currency, and tap **Continue**. | Dashboard showing "Hi, &lt;name&gt;" and **No balances yet**. Bottom bar with Dashboard, Groups, ＋, Friends and Activity; only Dashboard is active, the rest are dimmed (they arrive in M4–M6). |
| 6 | Switch to your phone's main browser, open the staging URL, and log in if you aren't already. | Dashboard, as above. Gmail's built-in browser and your main browser may keep separate sessions; that's expected. |
| 7 | Check the edges of the screen. | The header clears the notch or status bar; the bottom bar clears the home indicator; nothing is cut off in portrait. |
| 8 | Tap ☰ → **Dark**, then ☰ → **System**. | The theme switches immediately, and the choice is kept after a reload. |
| 9 | Tap ☰ → **Settings**, change your name, and tap **Save changes**. | "Profile saved." The new name shows on the dashboard. |
| 10 | Tap ☰ → **Log out**. | Login page. |
| 11 | Open `<staging URL>/dashboard` directly. | Redirected to **Log in**. After logging in, you're back on the dashboard. |
| 12 | Log in with a wrong password. | "Incorrect email or password." and nothing more. |
| 13 | *(Optional, uses the 2nd email of the hour.)* In your main browser, log out, tap **Forgot your password?** and request a link. Open the email and, if Gmail would use a different browser, copy the link (long-press) into that same main browser. Set a new password, then log in with it. | **Choose a new password** opens already logged in; afterwards "Your password has been updated." shows on Settings, and the new password works. If the link opens in a different browser, you get the different-browser message instead; request a new link and open it in the main browser. |
| 14 | In the Supabase dashboard, open **Authentication → Users** and **Table Editor → profiles**. | The user is confirmed. The profile has your name, currency and time zone, and `onboarded_at` is set. |

Report anything off with a screenshot and the step number.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Build fails: "NEXT_PUBLIC_APP_URL is missing: Vercel Production must set it explicitly" | A push to `main` without the Production variables. | [P4](#p4-vercel-production-environment), then redeploy. |
| Build fails with other "Invalid environment variables" | A Supabase variable is missing for that environment. | Section 4, then redeploy. |
| Vercel "Authentication required" page, or a redirect to `vercel.com/sso-api` | Deployment Protection is still on. | Section 4, Deployment Protection. |
| Sign-up says "We can't send email to that address yet" | The address isn't in your Supabase organization (built-in mailer). | Use your Supabase-account email, invite the tester to the org, or set up custom SMTP (**Authentication → Emails → SMTP Settings**). |
| "Too many emails sent" | The built-in mailer's limit (about 2/hour). | Wait an hour, or set up custom SMTP. It starts at 30/hour, adjustable under **Authentication → Rate Limits**. |
| Email link points at `localhost`, the Site URL, or the wrong branch | `NEXT_PUBLIC_APP_URL` was added to Preview (it overrides the branch URL), or the URL isn't on the redirect list, so Auth fell back to the Site URL. | Remove `NEXT_PUBLIC_APP_URL` from Preview and redeploy; check the redirect URLs (section 3). |
| Link opens `/login?error=link` ("invalid or has expired"), possibly with `#error=access_denied&error_code=otp_expired` after it | The link was already used, it expired (1 hour), or a mail scanner opened it first. | Use **Resend confirmation email** on the login page, or request a new reset link. |
| Login page says the link was "opened in a different browser" | Default templates (`?code=` links): the PKCE code-verifier cookie lives in the browser that signed up or requested the reset. | Sign-up: the email is confirmed; just log in. Password reset: request a new link and open it in the same browser. Custom templates (section 3, after SMTP) remove this limit. |
| Files missing from the Vercel build (e.g. "Module not found") | A `.vercelignore` pattern matched more than intended. | Patterns must start with `/`; `npm test` checks this. The build log lists every removed file. |
| `db push` hangs at "Initialising login role..." (with `--debug`: `failed to connect to host=aws-0-<region>.pooler.supabase.com … Connection timed out`) | The network blocks Postgres traffic on the pooler's port 5432 even though plain TCP connects (seen on 2026-10-21). The CLI's password-free login role always uses 5432, and the direct `db.<ref>.supabase.co` host is IPv6-only. | Switch networks (e.g. a phone hotspot) and retry. A handshake test that can't trigger a login ban: `psql "host=aws-0-<region>.pooler.supabase.com port=5432 user=postgres.aaaaaaaaaaaaaaaaaaaa dbname=postgres sslmode=require"`. It should fail at once with "tenant/user … not found"; a timeout means 5432 is blocked. Port 6543 (transaction mode) may still work with the database password. |
| Pages are slow | The function region is far from the Supabase region, or the Free project is waking from a pause. | Match the regions (section 4); restore the project in the Supabase dashboard if it's paused. |

## E2E tests against staging

`npm run test:e2e:staging` runs the Playwright suite against the deployed staging app. Each run creates throwaway accounts on staging, and the suite deletes them at the end; their test groups and expenses stay as "Deleted user" history.

1. Create `.env.e2e.local` in the repo folder. It is git-ignored; never commit it or paste it anywhere:

   ```
   E2E_BASE_URL=https://splitmate-git-staging-kgsss1s-projects.vercel.app
   E2E_SUPABASE_URL=https://<staging-ref>.supabase.co
   E2E_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   E2E_SUPABASE_SECRET_KEY=sb_secret_...
   ```

   The secret key is the **staging** project's (Project Settings → API Keys). It is only used on your machine, to create accounts that are already confirmed (no emails are sent) and to delete them afterwards. The suite refuses any host without `staging` in it, so it can't run against production.

2. Run it:

   ```bash
   npm run test:e2e:staging -- --workers=2
   ```

What differs from a local run:
- The tests that read emails from local Mailpit are skipped: sign-up by email, password reset by email, and the default-template link tests. They run locally.
- Timeouts are longer, since a deployed app is slower per request than a warm local server.
- Supabase Auth's sign-in rate limit (per IP, **Authentication → Rate Limits**) can trip on a full run. Lower `--workers`, or raise the limit on staging only.

## Never against production

Never run `seed.sql`, `db reset`, `--include-seed` or any test against production.

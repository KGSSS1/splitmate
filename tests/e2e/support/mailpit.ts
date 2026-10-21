import { expect } from "@playwright/test";

/** Local Supabase's mail inbox (`npx supabase status` → MAILPIT_URL). */
const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";

interface MailpitSearch {
  messages: { ID: string; Subject: string }[];
}

interface MailpitMessage {
  HTML: string;
}

/**
 * Waits for the newest email to `to` whose subject contains `subject` and
 * returns the first link in it that points at the app's /auth/confirm route.
 */
export async function getEmailLink(to: string, subject: string): Promise<string> {
  let link = "";
  await expect
    .poll(
      async () => {
        const search = await fetchJson<MailpitSearch>(
          `/api/v1/search?query=${encodeURIComponent(`to:"${to}" subject:"${subject}"`)}`,
        );
        const newest = search.messages[0];
        if (!newest) return "";
        const message = await fetchJson<MailpitMessage>(`/api/v1/message/${newest.ID}`);
        const href = /href="([^"]*\/auth\/confirm[^"]*)"/.exec(message.HTML)?.[1];
        link = href ? href.replaceAll("&amp;", "&") : "";
        return link;
      },
      { message: `email "${subject}" to ${to}`, timeout: 15_000 },
    )
    .not.toBe("");
  return link;
}

/** Local Supabase API (`npx supabase status` → API_URL). */
const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";

/**
 * The link Supabase's *default* `{{ .ConfirmationURL }}` template would have
 * sent for the same email: the auth server's /verify endpoint, which confirms
 * the token and redirects to the app with `?code=`. Built from the token hash
 * in the local custom-template email, so both link styles can be tested.
 */
export async function getDefaultTemplateLink(
  to: string,
  subject: string,
  type: "signup" | "recovery",
): Promise<string> {
  const customLink = new URL(await getEmailLink(to, subject));
  const tokenHash = customLink.searchParams.get("token_hash");
  if (!tokenHash) throw new Error(`No token_hash in ${customLink.href}`);
  const redirectTo = `${customLink.origin}${customLink.pathname}`;
  const verify = new URL("/auth/v1/verify", SUPABASE_URL);
  verify.searchParams.set("token", tokenHash);
  verify.searchParams.set("type", type);
  verify.searchParams.set("redirect_to", redirectTo);
  return verify.toString();
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${MAILPIT_URL}${path}`);
  if (!response.ok) throw new Error(`Mailpit ${path} → ${response.status}`);
  return (await response.json()) as T;
}

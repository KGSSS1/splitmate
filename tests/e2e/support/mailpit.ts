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

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${MAILPIT_URL}${path}`);
  if (!response.ok) throw new Error(`Mailpit ${path} → ${response.status}`);
  return (await response.json()) as T;
}

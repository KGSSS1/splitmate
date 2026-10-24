import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth";
import { countUnread } from "@/server/notifications";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * The unread badge's count. The badge asks on every navigation and when the
 * tab regains focus (SPEC §15: polling on navigation is enough for v1).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401, headers: NO_STORE });
  try {
    return Response.json({ unread: await countUnread(await createClient()) }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "Could not load notifications" }, { status: 500, headers: NO_STORE });
  }
}

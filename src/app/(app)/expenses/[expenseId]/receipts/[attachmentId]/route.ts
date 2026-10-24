import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation/groups";
import { requireUser } from "@/server/auth";

/** How long the link Storage serves the file from stays valid. */
const SIGNED_URL_SECONDS = 60;

function notFound() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
}

/**
 * Opens a receipt: re-checks that the caller can see it (RLS on `attachments`
 * and on the bucket) and redirects to a short-lived signed URL. Links on the
 * page point here, so they never expire while the page is open.
 */
export async function GET(_request: Request, { params }: RouteContext<"/expenses/[expenseId]/receipts/[attachmentId]">) {
  const { expenseId, attachmentId } = await params;
  if (!uuidSchema.safeParse(expenseId).success || !uuidSchema.safeParse(attachmentId).success) return notFound();

  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attachments")
    .select("storage_path")
    .eq("id", attachmentId)
    .eq("expense_id", expenseId)
    .maybeSingle();
  if (error || !data) return notFound();

  const { data: signed, error: signError } = await supabase.storage
    .from("receipts")
    .createSignedUrl(data.storage_path, SIGNED_URL_SECONDS);
  if (signError || !signed) return notFound();

  return new Response(null, {
    status: 302,
    headers: { Location: signed.signedUrl, "Cache-Control": "private, no-store" },
  });
}

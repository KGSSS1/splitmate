"use server";

import { refresh } from "next/cache";

import {
  MAX_RECEIPTS_PER_EXPENSE,
  RECEIPT_EXTENSIONS,
  receiptFileName,
  receiptProblem,
  SNIFF_BYTES,
  sniffReceiptType,
} from "@/lib/receipts/files";
import { createClient } from "@/lib/supabase/server";
import { attachReceiptSchema, prepareReceiptSchema, receiptIdSchema } from "@/lib/validation/receipts";
import { type ActionResult, invalidInput, rpcFailure } from "@/server/action-result";
import { requireOnboardedProfile } from "@/server/auth";

const BUCKET = "receipts";
const NOT_ALLOWED = "You can't add receipts to this expense.";

/**
 * Step 1 of an upload: a signed upload URL for a new object under the expense's
 * folder. Creating it runs the bucket's insert policy as the caller, so only
 * people who can change the expense get one. The browser uploads the file
 * straight to Storage (Vercel caps request bodies below 5 MB), then calls
 * `attachReceipt`.
 */
export async function prepareReceiptUpload(input: unknown): Promise<ActionResult<{ path: string; signedUrl: string }>> {
  const parsed = prepareReceiptSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { expenseId, type } = parsed.data;

  await requireOnboardedProfile();
  const supabase = await createClient();
  const { count, error: countError } = await supabase
    .from("attachments")
    .select("id", { count: "exact", head: true })
    .eq("expense_id", expenseId);
  if (countError) return { ok: false, error: "Couldn't start the upload. Please try again." };
  if ((count ?? 0) >= MAX_RECEIPTS_PER_EXPENSE) {
    return { ok: false, error: `An expense can have at most ${MAX_RECEIPTS_PER_EXPENSE} receipts.` };
  }

  const path = `${expenseId}/${crypto.randomUUID()}.${RECEIPT_EXTENSIONS[type]}`;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: NOT_ALLOWED };
  return { ok: true, data: { path, signedUrl: data.signedUrl } };
}

/**
 * Step 2: checks what actually arrived (type from its content, the type it is
 * served with, and its size) and records it. Anything that fails is deleted.
 */
export async function attachReceipt(input: unknown): Promise<ActionResult> {
  const parsed = attachReceiptSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { expenseId, path, fileName } = parsed.data;

  const profile = await requireOnboardedProfile();
  const supabase = await createClient();
  const discard = async () => {
    await supabase.storage.from(BUCKET).remove([path]);
  };

  const { data: file, error: downloadError } = await supabase.storage.from(BUCKET).download(path);
  if (downloadError || !file) return { ok: false, error: "The file didn't arrive. Please try again." };

  const type = sniffReceiptType(new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer()));
  const problem = receiptProblem(type, file.size);
  // The file is served with the type it was uploaded with, so that must be its real type too.
  if (problem || !type || (file.type && file.type.split(";")[0] !== type)) {
    await discard();
    return { ok: false, error: problem ?? "Choose a JPEG, PNG, WebP or PDF file." };
  }

  const { error } = await supabase.from("attachments").insert({
    expense_id: expenseId,
    uploaded_by: profile.id,
    storage_path: path,
    mime_type: type,
    size_bytes: file.size,
    file_name: receiptFileName(fileName, type),
  });
  if (error) {
    await discard();
    return error.code === "42501" ? { ok: false, error: NOT_ALLOWED } : rpcFailure(error);
  }

  refresh();
  return { ok: true, message: "Receipt added." };
}

/** Removes a receipt the caller added (RLS: own, while they can still change the expense). */
export async function deleteReceipt(input: unknown): Promise<ActionResult> {
  const parsed = receiptIdSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const profile = await requireOnboardedProfile();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attachments")
    .delete()
    .eq("id", parsed.data.attachmentId)
    .eq("uploaded_by", profile.id)
    .select("storage_path");
  const removed = data?.[0];
  if (error || !removed) return { ok: false, error: "Couldn't remove that receipt." };
  // The row is gone, so nobody is shown the file any more; the object follows.
  await supabase.storage.from(BUCKET).remove([removed.storage_path]);

  refresh();
  return { ok: true, message: "Receipt removed." };
}

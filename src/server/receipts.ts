import "server-only";

import { isReceiptType, type ReceiptType } from "@/lib/receipts/files";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth";
import { getPersonCards, nameOf } from "@/server/people";

export interface Receipt {
  id: string;
  fileName: string;
  type: ReceiptType;
  sizeBytes: number;
  uploadedBy: string;
  uploaderName: string;
  createdAt: string;
}

/** The receipts of an expense the caller can see (RLS: same rule as the expense). */
export async function listReceipts(expenseId: string): Promise<Receipt[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attachments")
    .select("id, file_name, mime_type, size_bytes, uploaded_by, created_at")
    .eq("expense_id", expenseId)
    .order("created_at")
    .order("id");
  if (error) throw new Error("Could not load the receipts.");
  const cards = await getPersonCards(supabase, data.map((row) => row.uploaded_by));
  return data.flatMap((row) =>
    isReceiptType(row.mime_type)
      ? [
          {
            id: row.id,
            fileName: row.file_name ?? "Receipt",
            type: row.mime_type,
            sizeBytes: row.size_bytes,
            uploadedBy: row.uploaded_by,
            uploaderName: nameOf(cards, row.uploaded_by),
            createdAt: row.created_at,
          },
        ]
      : [],
  );
}

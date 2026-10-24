"use client";

import { LoaderCircle, Paperclip } from "lucide-react";
import { useId, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { getClientEnv } from "@/lib/env";
import { compressImage } from "@/lib/receipts/compress";
import { RECEIPT_TYPES, type ReceiptType, receiptProblem, SNIFF_BYTES, sniffReceiptType } from "@/lib/receipts/files";
import { cn } from "@/lib/utils";
import { attachReceipt, prepareReceiptUpload } from "@/server/actions/receipts";

const NETWORK_ERROR = "Couldn't upload the receipt. Check your connection and try again.";

type Status = { kind: "idle" } | { kind: "working"; step: string } | { kind: "error"; message: string } | { kind: "done" };

/** Picks a file, shrinks photos, then prepares a signed upload, uploads straight to Storage and attaches it. */
async function uploadReceipt(expenseId: string, file: File, onStep: (step: string) => void): Promise<string | null> {
  const type = sniffReceiptType(new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer()));
  let body: Blob = file;
  let bodyType: ReceiptType | null = type;
  if (type && type !== "application/pdf") {
    onStep("Shrinking the photo…");
    const smaller = await compressImage(file).catch(() => null);
    if (smaller) {
      body = smaller;
      bodyType = sniffReceiptType(new Uint8Array(await smaller.slice(0, SNIFF_BYTES).arrayBuffer()));
    }
  }
  const problem = receiptProblem(bodyType, body.size);
  if (problem || !bodyType) return problem ?? "Choose a JPEG, PNG, WebP or PDF file.";

  onStep("Uploading…");
  const prepared = await prepareReceiptUpload({ expenseId, type: bodyType, size: body.size });
  if (!prepared.ok) return prepared.error;
  if (!prepared.data) return NETWORK_ERROR;
  const response = await fetch(prepared.data.signedUrl, {
    method: "PUT",
    headers: {
      apikey: getClientEnv().NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      "content-type": bodyType,
      "x-upsert": "false",
    },
    body,
  });
  if (!response.ok) return NETWORK_ERROR;

  onStep("Checking the file…");
  const attached = await attachReceipt({ expenseId, path: prepared.data.path, fileName: file.name });
  return attached.ok ? null : attached.error;
}

/**
 * "Add receipt": JPEG, PNG, WebP or PDF up to 5 MB (SPEC §8). The type is read
 * from the file's content here for quick feedback and again on the server.
 */
export function ReceiptUploader({ expenseId }: { expenseId: string }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const inputId = useId();
  const statusId = `${inputId}-status`;
  const working = status.kind === "working";

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setStatus({ kind: "working", step: "Reading the file…" });
    let error: string | null;
    try {
      error = await uploadReceipt(expenseId, file, (step) => setStatus({ kind: "working", step }));
    } catch {
      error = NETWORK_ERROR;
    }
    setStatus(error ? { kind: "error", message: error } : { kind: "done" });
  }

  return (
    <div className="grid gap-2">
      <label
        htmlFor={inputId}
        className={cn(
          buttonVariants({ variant: "outline" }),
          "h-11 cursor-pointer justify-self-start md:h-8",
          "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
          working && "pointer-events-none opacity-50",
        )}
      >
        {working ? <LoaderCircle aria-hidden className="animate-spin" /> : <Paperclip aria-hidden />}
        Add receipt
        <input
          id={inputId}
          type="file"
          className="sr-only"
          accept={RECEIPT_TYPES.join(",")}
          disabled={working}
          aria-describedby={statusId}
          onChange={onChange}
        />
      </label>
      <p
        id={statusId}
        role={status.kind === "error" ? "alert" : "status"}
        className={cn("text-xs", status.kind === "error" ? "text-destructive" : "text-muted-foreground")}
      >
        {status.kind === "working"
          ? status.step
          : status.kind === "error"
            ? status.message
            : status.kind === "done"
              ? "Receipt added."
              : "JPEG, PNG, WebP or PDF, up to 5 MB. Photos are shrunk before upload."}
      </p>
    </div>
  );
}

/**
 * Receipt files (SPEC §8): JPEG, PNG, WebP or PDF, at most 5 MB, recognised by
 * their content rather than their name or declared type. Shared by the upload
 * form (early feedback) and the Server Action (the real check).
 */

export const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type ReceiptType = (typeof RECEIPT_TYPES)[number];

/** Mirrors the `receipts` bucket's `file_size_limit` and `attachments.size_bytes` check. */
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

/** Mirrors the `attachments_check` trigger. */
export const MAX_RECEIPTS_PER_EXPENSE = 10;

/** How many leading bytes `sniffReceiptType` needs. */
export const SNIFF_BYTES = 12;

export const RECEIPT_EXTENSIONS: Record<ReceiptType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export const RECEIPT_TYPE_LABELS: Record<ReceiptType, string> = {
  "image/jpeg": "JPEG image",
  "image/png": "PNG image",
  "image/webp": "WebP image",
  "application/pdf": "PDF",
};

export function isReceiptType(value: unknown): value is ReceiptType {
  return typeof value === "string" && (RECEIPT_TYPES as readonly string[]).includes(value);
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** The receipt type a file's first bytes show, or null for anything else. */
export function sniffReceiptType(bytes: Uint8Array): ReceiptType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // "RIFF" <size> "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  // "%PDF-"
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  return null;
}

/**
 * A display name for the uploaded file: no path, no control characters, at
 * most 120 characters, and the extension of its real type.
 */
export function receiptFileName(original: string, type: ReceiptType): string {
  const base = original.split(/[\\/]/).pop() ?? "";
  const stem = base
    .replace(/\.[^.]*$/, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 100);
  return `${stem || "receipt"}.${RECEIPT_EXTENSIONS[type]}`;
}

/** "1.2 MB", "340 KB". */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Why a file can't be a receipt, or null when it can (type from its content). */
export function receiptProblem(type: ReceiptType | null, size: number): string | null {
  if (!type) return "Choose a JPEG, PNG, WebP or PDF file.";
  if (size <= 0) return "That file is empty.";
  if (size > MAX_RECEIPT_BYTES) return "Receipts can be at most 5 MB.";
  return null;
}

/**
 * The size an image is scaled to before upload: the longest side at most
 * `maxSide` pixels, never enlarged.
 */
export function scaledSize(width: number, height: number, maxSide = 2000): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide || longest <= 0) return { width, height };
  const scale = maxSide / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

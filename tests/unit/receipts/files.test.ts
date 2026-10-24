import { describe, expect, it } from "vitest";

import {
  formatFileSize,
  MAX_RECEIPT_BYTES,
  receiptFileName,
  receiptProblem,
  scaledSize,
  sniffReceiptType,
} from "@/lib/receipts/files";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);

describe("sniffReceiptType", () => {
  it("recognises each allowed type by its content", () => {
    expect(sniffReceiptType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe("image/jpeg");
    expect(sniffReceiptType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(sniffReceiptType(ascii("RIFF\u0010\u0000\u0000\u0000WEBPVP8 "))).toBe("image/webp");
    expect(sniffReceiptType(ascii("%PDF-1.7\n"))).toBe("application/pdf");
  });

  it("rejects everything else, whatever the file is called", () => {
    expect(sniffReceiptType(ascii("GIF89a"))).toBeNull();
    expect(sniffReceiptType(ascii("<html><script>"))).toBeNull();
    expect(sniffReceiptType(ascii("RIFF\u0010\u0000\u0000\u0000WAVE"))).toBeNull();
    expect(sniffReceiptType(ascii("%PD"))).toBeNull();
    expect(sniffReceiptType(new Uint8Array())).toBeNull();
  });
});

describe("receiptProblem", () => {
  it("accepts a known type up to 5 MB", () => {
    expect(receiptProblem("image/png", 1)).toBeNull();
    expect(receiptProblem("application/pdf", MAX_RECEIPT_BYTES)).toBeNull();
  });

  it("explains what is wrong otherwise", () => {
    expect(receiptProblem(null, 100)).toBe("Choose a JPEG, PNG, WebP or PDF file.");
    expect(receiptProblem("image/jpeg", 0)).toBe("That file is empty.");
    expect(receiptProblem("image/jpeg", MAX_RECEIPT_BYTES + 1)).toBe("Receipts can be at most 5 MB.");
  });
});

describe("receiptFileName", () => {
  it("keeps the name, drops any path and uses the real type's extension", () => {
    expect(receiptFileName("C:\\Users\\me\\Dinner bill.PNG", "image/webp")).toBe("Dinner bill.webp");
    expect(receiptFileName("../../etc/passwd", "application/pdf")).toBe("passwd.pdf");
    expect(receiptFileName("scan.jpeg", "image/jpeg")).toBe("scan.jpg");
  });

  it("falls back to 'receipt' and strips control characters", () => {
    expect(receiptFileName("", "image/png")).toBe("receipt.png");
    expect(receiptFileName("\u0000\u001f.pdf", "application/pdf")).toBe("receipt.pdf");
    expect(receiptFileName(`${"a".repeat(300)}.pdf`, "application/pdf")).toHaveLength(104);
  });
});

describe("scaledSize", () => {
  it("shrinks the longest side to the limit and keeps the aspect ratio", () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(scaledSize(1000, 5000, 1000)).toEqual({ width: 200, height: 1000 });
  });

  it("never enlarges", () => {
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("formatFileSize", () => {
  it("shows KB or MB", () => {
    expect(formatFileSize(340 * 1024)).toBe("340 KB");
    expect(formatFileSize(1.25 * 1024 * 1024)).toBe("1.3 MB");
    expect(formatFileSize(10)).toBe("1 KB");
  });
});

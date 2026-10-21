import { describe, expect, it } from "vitest";

import { createIdempotencyKey, isIdempotencyKey } from "@/lib/accounting/idempotency";
import { buildExpenseEntries } from "@/lib/accounting/ledger";
import { splitEqual } from "@/lib/accounting/splits";

describe("idempotency", () => {
  it("creates unique UUID v4 keys", () => {
    const keys = new Set(Array.from({ length: 1000 }, () => createIdempotencyKey()));
    expect(keys.size).toBe(1000);
    for (const key of keys) expect(isIdempotencyKey(key)).toBe(true);
  });

  it("rejects anything that is not a UUID v4", () => {
    expect(isIdempotencyKey("")).toBe(false);
    expect(isIdempotencyKey("not-a-key")).toBe(false);
    expect(isIdempotencyKey("00000000-0000-1000-8000-000000000000")).toBe(false); // v1
    expect(isIdempotencyKey("3F2504E0-4F89-41D3-9A0C-0305E82C3301")).toBe(true);
  });

  it("a retried submission produces identical ledger rows (safe to dedupe on the key)", () => {
    const input = {
      expenseId: "e1",
      version: 1,
      groupId: "g",
      currency: "INR",
      total: 9001,
      payers: [
        { userId: "a", amount: 6001 },
        { userId: "b", amount: 3000 },
      ],
      shares: splitEqual(9001, ["a", "b", "c", "d"]),
    };
    expect(buildExpenseEntries(structuredClone(input))).toEqual(buildExpenseEntries(structuredClone(input)));
  });
});

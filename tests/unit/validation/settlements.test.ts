import { describe, expect, it } from "vitest";

import {
  createSettlementSchema,
  isSettlementDate,
  settleUpEverythingSchema,
  settleUpFormSchema,
} from "@/lib/validation/settlements";

const PERSON = "22222222-2222-4222-8222-222222222222";
const KEY = "7b0c7ad4-4a3e-4c55-9a6f-1d1f5b0b7e10";

const values = (overrides: Record<string, unknown> = {}) => ({
  personId: PERSON,
  direction: "paid",
  amount: "100",
  currency: "INR",
  method: "cash",
  upiReference: "",
  note: "",
  settledOn: "2026-10-21",
  ...overrides,
});

function issues(input: unknown) {
  const result = settleUpFormSchema.safeParse(input);
  return result.success ? {} : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message]));
}

describe("settleUpFormSchema", () => {
  it("accepts a repayment", () => {
    expect(settleUpFormSchema.safeParse(values()).success).toBe(true);
    expect(settleUpFormSchema.safeParse(values({ amount: "1,23,456.78", method: "upi", upiReference: "UPI-12 34/5" })).success).toBe(true);
  });

  it("checks the amount with the currency's exponent, never as a float", () => {
    expect(issues(values({ amount: "" })).amount).toBe("Enter an amount.");
    expect(issues(values({ amount: "0" })).amount).toBe("Enter an amount above zero.");
    expect(issues(values({ amount: "-5" })).amount).toBe("Amounts can't be negative.");
    expect(issues(values({ amount: "10.5", currency: "JPY" })).amount).toBe("Too many decimal places for this currency.");
    expect(issues(values({ amount: "10.555", currency: "KWD" })).amount).toBeUndefined();
  });

  it("needs a person, a direction, a known method and currency", () => {
    expect(issues(values({ personId: "" })).personId).toBe("Choose who you settled up with.");
    expect(issues(values({ direction: "both" })).direction).toBe("Choose who paid.");
    expect(issues(values({ method: "cheque" })).method).toBe("Choose how it was paid.");
    expect(issues(values({ currency: "XXX" })).currency).toBeDefined();
  });

  it("limits the UPI reference and the note", () => {
    expect(issues(values({ upiReference: "x".repeat(65) })).upiReference).toBeDefined();
    expect(issues(values({ upiReference: "<script>" })).upiReference).toBeDefined();
    expect(issues(values({ note: "x".repeat(501) })).note).toBeDefined();
  });

  it("refuses future dates", () => {
    expect(issues(values({ settledOn: "2999-01-01" })).settledOn).toBe("Choose a date up to today.");
    expect(issues(values({ settledOn: "2026-02-30" })).settledOn).toBeDefined();
  });
});

describe("isSettlementDate", () => {
  const now = new Date("2026-10-21T20:00:00Z");
  it("allows today and tomorrow (time zones), not later", () => {
    expect(isSettlementDate("2026-10-21", now)).toBe(true);
    expect(isSettlementDate("2026-10-22", now)).toBe(true);
    expect(isSettlementDate("2026-10-23", now)).toBe(false);
    expect(isSettlementDate("1999-12-31", now)).toBe(false);
    expect(isSettlementDate("21-10-2026", now)).toBe(false);
  });
});

describe("action schemas", () => {
  it("createSettlementSchema needs an idempotency key and allows a null group (direct)", () => {
    expect(createSettlementSchema.safeParse({ idempotencyKey: KEY, groupId: null, values: values() }).success).toBe(true);
    expect(createSettlementSchema.safeParse({ idempotencyKey: "nope", groupId: null, values: values() }).success).toBe(false);
    expect(createSettlementSchema.safeParse({ idempotencyKey: KEY, groupId: "group", values: values() }).success).toBe(false);
  });

  it("settleUpEverythingSchema needs a friend ID and a key", () => {
    const input = { idempotencyKey: KEY, friendId: PERSON, method: "upi", upiReference: "", note: "" };
    expect(settleUpEverythingSchema.safeParse(input).success).toBe(true);
    expect(settleUpEverythingSchema.safeParse({ ...input, friendId: "x" }).success).toBe(false);
  });
});

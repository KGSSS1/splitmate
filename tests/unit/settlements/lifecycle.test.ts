import { describe, expect, it } from "vitest";

import { AccountingError } from "@/lib/accounting/errors";
import { initialSettlementStatus, transitionSettlement } from "@/lib/settlements/lifecycle";

const parties = { payerId: "payer", receiverId: "receiver" };

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AccountingError);
    expect((error as AccountingError).code).toBe(code);
    return;
  }
  throw new Error(`expected AccountingError ${code}`);
}

describe("settlement lifecycle (SPEC §2, §11)", () => {
  it("completes immediately when the receiver records it", () => {
    expect(initialSettlementStatus(parties, "receiver")).toEqual({ status: "completed", ledgerEffect: "apply" });
  });

  it("stays pending when the payer records it", () => {
    expect(initialSettlementStatus(parties, "payer")).toEqual({ status: "pending", ledgerEffect: "none" });
  });

  it("only the payer or receiver can record a settlement", () => {
    expectCode(() => initialSettlementStatus(parties, "stranger"), "NOT_A_PARTY");
    expectCode(() => initialSettlementStatus({ payerId: "x", receiverId: "x" }, "x"), "SAME_USER");
  });

  it("the receiver confirms or rejects a pending settlement", () => {
    const pending = { ...parties, status: "pending" as const };
    expect(transitionSettlement(pending, "confirm", "receiver")).toEqual({ status: "completed", ledgerEffect: "apply" });
    expect(transitionSettlement(pending, "reject", "receiver")).toEqual({ status: "rejected", ledgerEffect: "none" });
  });

  it("the payer cannot confirm their own settlement", () => {
    const pending = { ...parties, status: "pending" as const };
    expectCode(() => transitionSettlement(pending, "confirm", "payer"), "NOT_ALLOWED");
    expectCode(() => transitionSettlement(pending, "reject", "payer"), "NOT_ALLOWED");
  });

  it("the payer can withdraw a pending settlement with no balance effect", () => {
    const pending = { ...parties, status: "pending" as const };
    expect(transitionSettlement(pending, "cancel", "payer")).toEqual({ status: "cancelled", ledgerEffect: "none" });
    expectCode(() => transitionSettlement(pending, "cancel", "receiver"), "NOT_ALLOWED");
  });

  it("either party can cancel a completed settlement, which reverses it", () => {
    const completed = { ...parties, status: "completed" as const };
    expect(transitionSettlement(completed, "cancel", "payer")).toEqual({ status: "cancelled", ledgerEffect: "reverse" });
    expect(transitionSettlement(completed, "cancel", "receiver")).toEqual({
      status: "cancelled",
      ledgerEffect: "reverse",
    });
  });

  it("a completed settlement cannot be applied twice", () => {
    const completed = { ...parties, status: "completed" as const };
    expectCode(() => transitionSettlement(completed, "confirm", "receiver"), "INVALID_TRANSITION");
  });

  it("rejected and cancelled settlements are final", () => {
    for (const status of ["rejected", "cancelled"] as const) {
      for (const action of ["confirm", "reject", "cancel"] as const) {
        expectCode(() => transitionSettlement({ ...parties, status }, action, "receiver"), "INVALID_TRANSITION");
      }
    }
  });

  it("outsiders can never act", () => {
    expectCode(
      () => transitionSettlement({ ...parties, status: "completed" }, "cancel", "stranger"),
      "NOT_A_PARTY",
    );
  });
});

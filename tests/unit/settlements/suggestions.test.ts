import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { AccountingError } from "@/lib/accounting/errors";
import { availableSettlementActions } from "@/lib/settlements/lifecycle";
import { suggestedTransfers, transfersInvolving } from "@/lib/settlements/suggestions";

describe("suggestedTransfers (SPEC §7)", () => {
  // A paid ₹900 for A, B, C; then A owes B ₹200 directly through another expense.
  const nets = [
    { userId: "a", currency: "INR", amount: 40000 },
    { userId: "b", currency: "INR", amount: -10000 },
    { userId: "c", currency: "INR", amount: -30000 },
  ];
  const pairwise = [
    { debtorId: "b", creditorId: "a", currency: "INR", amount: 30000 },
    { debtorId: "c", creditorId: "a", currency: "INR", amount: 30000 },
    { debtorId: "a", creditorId: "b", currency: "INR", amount: 20000 },
  ];

  it("simplifies from net balances when the toggle is on", () => {
    expect(suggestedTransfers({ simplify: true, nets, pairwise })).toEqual([
      { fromUserId: "c", toUserId: "a", amount: 30000, currency: "INR" },
      { fromUserId: "b", toUserId: "a", amount: 10000, currency: "INR" },
    ]);
  });

  it("lists the raw pairwise debts when the toggle is off, largest first", () => {
    expect(suggestedTransfers({ simplify: false, nets, pairwise })).toEqual([
      { fromUserId: "b", toUserId: "a", amount: 30000, currency: "INR" },
      { fromUserId: "c", toUserId: "a", amount: 30000, currency: "INR" },
      { fromUserId: "a", toUserId: "b", amount: 20000, currency: "INR" },
    ]);
  });

  it("never mixes currencies and sorts by currency first", () => {
    const transfers = suggestedTransfers({
      simplify: true,
      nets: [
        { userId: "a", currency: "USD", amount: 500 },
        { userId: "b", currency: "USD", amount: -500 },
        { userId: "a", currency: "INR", amount: -100 },
        { userId: "b", currency: "INR", amount: 100 },
      ],
      pairwise: [],
    });
    expect(transfers).toEqual([
      { fromUserId: "a", toUserId: "b", amount: 100, currency: "INR" },
      { fromUserId: "b", toUserId: "a", amount: 500, currency: "USD" },
    ]);
  });

  it("returns nothing when everyone is settled up", () => {
    expect(suggestedTransfers({ simplify: true, nets: [], pairwise: [] })).toEqual([]);
    expect(suggestedTransfers({ simplify: false, nets: [], pairwise: [] })).toEqual([]);
  });

  it("rejects malformed pairwise rows", () => {
    const bad = (row: Partial<(typeof pairwise)[number]>) => () =>
      suggestedTransfers({ simplify: false, nets: [], pairwise: [{ ...pairwise[0]!, ...row }] });
    expect(bad({ amount: 0 })).toThrow(AccountingError);
    expect(bad({ amount: 1.5 })).toThrow(AccountingError);
    expect(bad({ creditorId: "b" })).toThrow(AccountingError);
    expect(bad({ currency: "XXX" })).toThrow(AccountingError);
  });

  it("property: pairwise suggestions clear every member's net balance", () => {
    const people = ["a", "b", "c", "d"];
    const debt = fc.record({
      debtorId: fc.constantFrom(...people),
      creditorId: fc.constantFrom(...people),
      amount: fc.integer({ min: 1, max: 1_000_000 }),
    });
    fc.assert(
      fc.property(fc.array(debt, { maxLength: 12 }), (rows) => {
        const valid = rows.filter((row) => row.debtorId !== row.creditorId).map((row) => ({ ...row, currency: "INR" }));
        const net = new Map<string, number>();
        for (const row of valid) {
          net.set(row.creditorId, (net.get(row.creditorId) ?? 0) + row.amount);
          net.set(row.debtorId, (net.get(row.debtorId) ?? 0) - row.amount);
        }
        for (const transfer of suggestedTransfers({ simplify: false, nets: [], pairwise: valid })) {
          net.set(transfer.fromUserId, (net.get(transfer.fromUserId) ?? 0) + transfer.amount);
          net.set(transfer.toUserId, (net.get(transfer.toUserId) ?? 0) - transfer.amount);
        }
        return [...net.values()].every((amount) => amount === 0);
      }),
    );
  });

  it("transfersInvolving keeps only what the viewer can record", () => {
    const transfers = suggestedTransfers({ simplify: false, nets, pairwise });
    expect(transfersInvolving(transfers, "c")).toEqual([{ fromUserId: "c", toUserId: "a", amount: 30000, currency: "INR" }]);
    expect(transfersInvolving(transfers, "z")).toEqual([]);
  });

  // Review L40: the receiver sees what they can record as received.
  it("transfersInvolving includes the payments coming to the viewer", () => {
    const raw = suggestedTransfers({ simplify: false, nets, pairwise });
    expect(transfersInvolving(raw, "a")).toEqual([
      { fromUserId: "b", toUserId: "a", amount: 30000, currency: "INR" },
      { fromUserId: "c", toUserId: "a", amount: 30000, currency: "INR" },
      { fromUserId: "a", toUserId: "b", amount: 20000, currency: "INR" },
    ]);
    const simplified = suggestedTransfers({ simplify: true, nets, pairwise });
    expect(transfersInvolving(simplified, "a").every((transfer) => transfer.toUserId === "a")).toBe(true);
    expect(transfersInvolving(simplified, "a").reduce((sum, transfer) => sum + transfer.amount, 0)).toBe(40000);
  });
});

describe("availableSettlementActions", () => {
  const parties = { payerId: "payer", receiverId: "receiver" };

  it("the receiver confirms or rejects a pending settlement; the payer withdraws it", () => {
    expect(availableSettlementActions({ ...parties, status: "pending" }, "receiver")).toEqual(["confirm", "reject"]);
    expect(availableSettlementActions({ ...parties, status: "pending" }, "payer")).toEqual(["cancel"]);
  });

  it("either person can cancel a completed settlement", () => {
    expect(availableSettlementActions({ ...parties, status: "completed" }, "receiver")).toEqual(["cancel"]);
    expect(availableSettlementActions({ ...parties, status: "completed" }, "payer")).toEqual(["cancel"]);
  });

  it("final states and outsiders get nothing", () => {
    expect(availableSettlementActions({ ...parties, status: "rejected" }, "receiver")).toEqual([]);
    expect(availableSettlementActions({ ...parties, status: "cancelled" }, "payer")).toEqual([]);
    expect(availableSettlementActions({ ...parties, status: "pending" }, "stranger")).toEqual([]);
  });
});

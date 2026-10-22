import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { AccountingError } from "@/lib/accounting/errors";
import { friendContextBalances, settleableWith } from "@/lib/settlements/friend-view";

const G = "group-simplified";
const H = "group-raw";

describe("friendContextBalances (SPEC §2, §7)", () => {
  it("after the simplified plan is followed, nothing is owed, even if raw pairwise rows still form a cycle", () => {
    // Raw cycle left behind: A owes B 100, B owes C 100, C owes A 100; every net is 0.
    expect(
      friendContextBalances({
        viewerId: "a",
        raw: [
          { counterpartyId: "b", groupId: G, currency: "INR", amount: -10000, simplified: true },
          { counterpartyId: "c", groupId: G, currency: "INR", amount: 10000, simplified: true },
        ],
        groupNets: [],
      }),
    ).toEqual([]);
  });

  it("uses the group's simplified plan for groups that simplify, raw rows elsewhere", () => {
    // In G, nets: A +200, B −400, C +200 → plan: B pays A 200, B pays C 200.
    // Raw in G (ignored): B owes A 100, B owes C 300. In H (raw): A owes B 50. Direct: B owes A 7.
    const rows = friendContextBalances({
      viewerId: "a",
      raw: [
        { counterpartyId: "b", groupId: G, currency: "INR", amount: 10000, simplified: true },
        { counterpartyId: "b", groupId: H, currency: "INR", amount: -5000, simplified: false },
        { counterpartyId: "b", groupId: null, currency: "INR", amount: 700, simplified: false },
      ],
      groupNets: [
        { groupId: G, userId: "a", currency: "INR", amount: 20000 },
        { groupId: G, userId: "b", currency: "INR", amount: -40000 },
        { groupId: G, userId: "c", currency: "INR", amount: 20000 },
      ],
    });
    expect(rows).toEqual([
      { counterpartyId: "b", groupId: null, currency: "INR", amount: 700, simplified: false },
      { counterpartyId: "b", groupId: H, currency: "INR", amount: -5000, simplified: false },
      { counterpartyId: "b", groupId: G, currency: "INR", amount: 20000, simplified: true },
    ]);
  });

  it("shows what the viewer pays as negative, and keeps currencies apart", () => {
    const rows = friendContextBalances({
      viewerId: "b",
      raw: [],
      groupNets: [
        { groupId: G, userId: "a", currency: "INR", amount: 20000 },
        { groupId: G, userId: "b", currency: "INR", amount: -20000 },
        { groupId: G, userId: "a", currency: "USD", amount: -300 },
        { groupId: G, userId: "b", currency: "USD", amount: 300 },
      ],
    });
    expect(rows).toEqual([
      { counterpartyId: "a", groupId: G, currency: "INR", amount: -20000, simplified: true },
      { counterpartyId: "a", groupId: G, currency: "USD", amount: 300, simplified: true },
    ]);
  });

  it("the two people of a pair see the same amount with opposite signs", () => {
    const groupNets = [
      { groupId: G, userId: "a", currency: "INR", amount: 30000 },
      { groupId: G, userId: "b", currency: "INR", amount: -10000 },
      { groupId: G, userId: "c", currency: "INR", amount: -20000 },
    ];
    const forA = friendContextBalances({ viewerId: "a", raw: [], groupNets });
    const forC = friendContextBalances({ viewerId: "c", raw: [], groupNets });
    expect(forA.find((row) => row.counterpartyId === "c")?.amount).toBe(20000);
    expect(forC.find((row) => row.counterpartyId === "a")?.amount).toBe(-20000);
  });

  it("rejects malformed raw rows", () => {
    const bad = (amount: number, currency = "INR") => () =>
      friendContextBalances({
        viewerId: "a",
        raw: [{ counterpartyId: "b", groupId: null, currency, amount, simplified: false }],
        groupNets: [],
      });
    expect(bad(0)).toThrow(AccountingError);
    expect(bad(1.5)).toThrow(AccountingError);
    expect(bad(100, "XXX")).toThrow(AccountingError);
  });

  it("property: in a simplified group, the viewer's rows add up exactly to their net", () => {
    const people = ["a", "b", "c", "d", "e"];
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -100_000, max: 100_000 }), { minLength: 4, maxLength: 4 }), (amounts) => {
        const last = -amounts.reduce((sum, amount) => sum + amount, 0);
        const nets = [...amounts, last]
          .map((amount, index) => ({ groupId: G, userId: people[index] ?? "", currency: "INR", amount }))
          .filter((row) => row.amount !== 0);
        for (const viewer of people) {
          const rows = friendContextBalances({ viewerId: viewer, raw: [], groupNets: nets });
          const net = nets.find((row) => row.userId === viewer)?.amount ?? 0;
          if (rows.reduce((sum, row) => sum + row.amount, 0) !== net) return false;
        }
        return true;
      }),
      { seed: 20261022, numRuns: 300 },
    );
  });
});

describe("settleableWith", () => {
  const rows = friendContextBalances({
    viewerId: "a",
    raw: [
      { counterpartyId: "b", groupId: null, currency: "INR", amount: 100, simplified: false },
      { counterpartyId: "b", groupId: "left-group", currency: "INR", amount: 200, simplified: false },
      { counterpartyId: "c", groupId: null, currency: "INR", amount: 300, simplified: false },
    ],
    groupNets: [
      { groupId: G, userId: "a", currency: "INR", amount: 400 },
      { groupId: G, userId: "b", currency: "INR", amount: -400 },
    ],
  });

  it("covers direct balances and groups both are still in, for that friend only", () => {
    expect(settleableWith(rows, "b", new Set([G])).map((row) => [row.groupId, row.amount])).toEqual([
      [null, 100],
      [G, 400],
    ]);
  });
});

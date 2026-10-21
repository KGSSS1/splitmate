/**
 * Property-based tests (fast-check) for the accounting invariants in SPEC §7.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { groupBalances, netBalances } from "@/lib/accounting/balances";
import { splitItemized } from "@/lib/accounting/itemized";
import {
  amendExpenseEntries,
  buildExpenseEntries,
  buildSettlementEntries,
  cancelExpenseEntries,
} from "@/lib/accounting/ledger";
import { allocatePairwise } from "@/lib/accounting/pairwise";
import { allocateByWeights } from "@/lib/accounting/rounding";
import { splitEqual, splitExact, splitPercentage, splitShares } from "@/lib/accounting/splits";
import type { LedgerEntry, Payer, Share } from "@/lib/accounting/types";

const USERS = ["u0", "u1", "u2", "u3", "u4", "u5", "u6", "u7"];
const sum = (values: { amount: number }[]) => values.reduce((acc, v) => acc + v.amount, 0);

const total = fc.integer({ min: 1, max: 10_000_000_000 });
const userSet = fc.shuffledSubarray(USERS, { minLength: 1 });

/** Splits `amount` into `parts` non-negative integers (used for payers and exact shares). */
function partition(amount: number, parts: number, seed: number[]): number[] {
  const weights = Array.from({ length: parts }, (_, i) => (seed[i] ?? 1) + 1);
  return allocateByWeights(
    amount,
    weights.map((weight, i) => ({ userId: String(i), weight })),
  ).map((s) => s.amount);
}

const expenseArb = fc
  .record({
    total,
    participants: userSet,
    payers: userSet,
    payerSeed: fc.array(fc.nat(1000), { minLength: 8, maxLength: 8 }),
    weights: fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 8, maxLength: 8 }),
    groupId: fc.constantFrom("g1", "g2", null),
    currency: fc.constantFrom("INR", "USD", "JPY"),
  })
  .map(({ total: amount, participants, payers, payerSeed, weights, groupId, currency }) => {
    const shares = splitShares(
      amount,
      participants.map((userId, i) => ({ userId, weight: weights[i] ?? 1 })),
    );
    const payerAmounts = partition(amount, payers.length, payerSeed);
    const payerRows: Payer[] = payers
      .map((userId, i) => ({ userId, amount: payerAmounts[i] ?? 0 }))
      .filter((p) => p.amount > 0);
    return { amount, shares, payers: payerRows, groupId, currency };
  });

function netsOf(entries: LedgerEntry[]) {
  return netBalances(entries);
}

describe("accounting properties", () => {
  it("every split method sums exactly to the total", () => {
    fc.assert(
      fc.property(
        total,
        userSet,
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 8, maxLength: 8 }),
        (amount, users, weights) => {
          expect(sum(splitEqual(amount, users))).toBe(amount);

          const shareRows = users.map((userId, i) => ({ userId, weight: weights[i] ?? 1 }));
          expect(sum(splitShares(amount, shareRows))).toBe(amount);

          const bps = partition(10000, users.length, weights);
          const percentage = splitPercentage(
            amount,
            users.map((userId, i) => ({ userId, basisPoints: bps[i] ?? 0 })),
          );
          expect(sum(percentage)).toBe(amount);

          const exactAmounts = partition(amount, users.length, weights);
          expect(sum(splitExact(amount, users.map((userId, i) => ({ userId, amount: exactAmounts[i] ?? 0 }))))).toBe(
            amount,
          );
        },
      ),
    );
  });

  it("rounding is deterministic and never gives more than one extra unit per person", () => {
    fc.assert(
      fc.property(total, userSet, (amount, users) => {
        const first = splitEqual(amount, users);
        expect(splitEqual(amount, users)).toEqual(first);
        const floor = Math.floor(amount / users.length);
        first.forEach((s) => expect(s.amount - floor).toBe(s.roundingUnit));
      }),
    );
  });

  it("itemized shares (with tax, tip, service, discount) sum exactly to the bill total", () => {
    const item = fc.record({
      amount: fc.integer({ min: 1, max: 1_000_000 }),
      assignments: fc
        .shuffledSubarray(USERS, { minLength: 1 })
        .chain((users) =>
          fc.tuple(...users.map((userId) => fc.integer({ min: 1, max: 5 }).map((weight) => ({ userId, weight })))),
        ),
    });
    const adjustment = fc.record({
      kind: fc.constantFrom("tax" as const, "service" as const, "tip" as const),
      amount: fc.integer({ min: 1, max: 100_000 }),
      allocation: fc.constantFrom("proportional" as const, "equal" as const),
    });

    fc.assert(
      fc.property(
        fc.array(item, { minLength: 1, maxLength: 6 }),
        fc.array(adjustment, { maxLength: 3 }),
        fc.integer({ min: 0, max: 99 }),
        (items, adjustments, discountPercent) => {
          const itemsTotal = sum(items);
          const discount = Math.floor((itemsTotal * discountPercent) / 100);
          const result = splitItemized({
            items,
            adjustments: [...adjustments, ...(discount > 0 ? [{ kind: "discount" as const, amount: discount }] : [])],
          });
          expect(result.total).toBe(itemsTotal + sum(adjustments) - discount);
          expect(sum(result.shares)).toBe(result.total);
          result.shares.forEach((s) => expect(s.amount).toBeGreaterThanOrEqual(0));
        },
      ),
    );
  });

  it("pairwise debts reconcile with every person's net position", () => {
    fc.assert(
      fc.property(expenseArb, ({ shares, payers }) => {
        const debts = allocatePairwise(payers, shares);
        const nets = new Map<string, number>();
        for (const d of debts) {
          expect(d.amount).toBeGreaterThan(0);
          expect(d.debtorId).not.toBe(d.creditorId);
          nets.set(d.creditorId, (nets.get(d.creditorId) ?? 0) + d.amount);
          nets.set(d.debtorId, (nets.get(d.debtorId) ?? 0) - d.amount);
        }
        for (const userId of USERS) {
          const paid = payers.find((p) => p.userId === userId)?.amount ?? 0;
          const owed = shares.find((s: Share) => s.userId === userId)?.amount ?? 0;
          expect(nets.get(userId) ?? 0).toBe(paid - owed);
        }
      }),
    );
  });

  it("ledger balances sum to zero per currency and per group", () => {
    fc.assert(
      fc.property(
        fc.array(expenseArb, { minLength: 1, maxLength: 10 }),
        fc.array(
          fc.record({
            payer: fc.constantFrom(...USERS),
            receiver: fc.constantFrom(...USERS),
            amount: fc.integer({ min: 1, max: 1_000_000 }),
            groupId: fc.constantFrom("g1", "g2", null),
            currency: fc.constantFrom("INR", "USD"),
          }),
          { maxLength: 5 },
        ),
        (expenses, settlements) => {
          const entries = [
            ...expenses.flatMap((e, i) =>
              buildExpenseEntries({ expenseId: `e${i}`, version: 1, ...e }),
            ),
            ...settlements
              .filter((s) => s.payer !== s.receiver)
              .flatMap((s, i) =>
                buildSettlementEntries({
                  settlementId: `s${i}`,
                  payerId: s.payer,
                  receiverId: s.receiver,
                  amount: s.amount,
                  currency: s.currency,
                  groupId: s.groupId,
                  status: "completed",
                }),
              ),
          ];
          for (const groupId of ["g1", "g2", null]) {
            const byCurrency = new Map<string, number>();
            for (const b of groupBalances(entries, groupId)) {
              byCurrency.set(b.currency, (byCurrency.get(b.currency) ?? 0) + b.amount);
            }
            for (const value of byCurrency.values()) expect(value).toBe(0);
          }
        },
      ),
    );
  });

  it("editing or cancelling an expense fully reverses its prior effect", () => {
    fc.assert(
      fc.property(expenseArb, expenseArb, (before, after) => {
        const v1 = buildExpenseEntries({ expenseId: "e", version: 1, ...before });
        const v2Input = { expenseId: "e", version: 2, ...after };
        const amendment = amendExpenseEntries(v1, v2Input);
        expect(netsOf([...v1, ...amendment])).toEqual(netsOf(buildExpenseEntries(v2Input)));
        expect(netsOf([...v1, ...cancelExpenseEntries(v1)])).toEqual([]);
      }),
    );
  });
});

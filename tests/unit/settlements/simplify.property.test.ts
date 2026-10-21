import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Balance } from "@/lib/accounting/types";
import { simplifyDebts } from "@/lib/settlements/simplify";

/** Random balances per currency that sum to zero (the last member absorbs the remainder). */
const zeroSumBalances = fc
  .record({
    inr: fc.array(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), { minLength: 1, maxLength: 60 }),
    usd: fc.array(fc.integer({ min: -1_000_000, max: 1_000_000 }), { maxLength: 10 }),
  })
  .map(({ inr, usd }) => {
    const build = (currency: string, values: number[]): Balance[] => {
      if (values.length === 0) return [];
      const last = -values.reduce((a, b) => a + b, 0);
      return [...values, last].map((amount, i) => ({ userId: `user-${i}`, currency, amount }));
    };
    return [...build("INR", inr), ...build("USD", usd)];
  });

describe("simplifyDebts properties", () => {
  it("always clears every balance and preserves each person's net", () => {
    fc.assert(
      fc.property(zeroSumBalances, (balances) => {
        const transfers = simplifyDebts(balances);
        const paid = new Map<string, number>();
        for (const t of transfers) {
          expect(t.amount).toBeGreaterThan(0);
          expect(t.fromUserId).not.toBe(t.toUserId);
          const from = `${t.currency}:${t.fromUserId}`;
          const to = `${t.currency}:${t.toUserId}`;
          paid.set(from, (paid.get(from) ?? 0) + t.amount);
          paid.set(to, (paid.get(to) ?? 0) - t.amount);
        }
        for (const b of balances) {
          // A debtor (negative) pays out exactly |net|; a creditor receives exactly net.
          expect(b.amount + (paid.get(`${b.currency}:${b.userId}`) ?? 0)).toBe(0);
        }
      }),
    );
  });

  it("uses at most n−1 transfers per currency for n non-zero members", () => {
    fc.assert(
      fc.property(zeroSumBalances, (balances) => {
        const transfers = simplifyDebts(balances);
        for (const currency of ["INR", "USD"]) {
          const nonZero = balances.filter((b) => b.currency === currency && b.amount !== 0).length;
          const count = transfers.filter((t) => t.currency === currency).length;
          expect(count).toBeLessThanOrEqual(Math.max(nonZero - 1, 0));
        }
      }),
    );
  });

  it("is deterministic regardless of input order", () => {
    fc.assert(
      fc.property(zeroSumBalances, fc.integer(), (balances, seed) => {
        const shuffled = [...balances].sort((x, y) => ((x.userId.length * seed) % 7) - ((y.userId.length * seed) % 7));
        expect(simplifyDebts(shuffled)).toEqual(simplifyDebts(balances));
      }),
    );
  });
});

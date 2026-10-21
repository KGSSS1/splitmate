import { AccountingError, requireAmount, requireUniqueUsers } from "./errors";
import type { PairwiseDebt, Payer, UserAmount, UserId } from "./types";

/** Payers must be unique, each positive, and add up to the expense amount. */
export function validatePayers(total: number, payers: readonly Payer[]): void {
  requireAmount(total, "Expense amount");
  const sum = sumPayers(payers);
  if (sum !== BigInt(total)) {
    throw new AccountingError("PAYERS_SUM_MISMATCH", `Payers add up to ${sum}, expected ${total}`);
  }
}

function sumPayers(payers: readonly Payer[]): bigint {
  if (payers.length === 0) throw new AccountingError("NO_PAYERS", "An expense needs at least one payer");
  requireUniqueUsers(
    payers.map((p) => p.userId),
    "Payers",
  );
  let sum = 0n;
  for (const { userId, amount } of payers) {
    requireAmount(amount, `Amount paid by ${userId}`);
    sum += BigInt(amount);
  }
  return sum;
}

/**
 * Turns payers and participant shares into pairwise debts (SPEC §6).
 *
 * Each person's net = paid − share. Every debtor's debt is allocated to the
 * creditors (payers who paid more than their share) in proportion to each
 * creditor's excess. The debtor × creditor matrix is rounded as a whole:
 * floors first, then leftover units to the largest remainders, with a
 * deterministic augmenting-path repair when greedy assignment would overpay a
 * creditor. Result: every debtor pays exactly |net| and every creditor
 * receives exactly their excess.
 *
 * Output order: debtors, then creditors, each in participant order (shares first, then other payers).
 */
export function allocatePairwise(payers: readonly Payer[], shares: readonly UserAmount[]): PairwiseDebt[] {
  const paidTotal = sumPayers(payers);
  requireUniqueUsers(
    shares.map((s) => s.userId),
    "Shares",
  );
  let shareTotal = 0n;
  for (const { userId, amount } of shares) {
    requireAmount(amount, `Share for ${userId}`, { allowZero: true });
    shareTotal += BigInt(amount);
  }
  if (shareTotal !== paidTotal) {
    throw new AccountingError(
      "SHARES_SUM_MISMATCH",
      `Shares add up to ${shareTotal} but payers add up to ${paidTotal}`,
    );
  }

  const people: UserId[] = [...shares.map((s) => s.userId)];
  for (const { userId } of payers) if (!people.includes(userId)) people.push(userId);
  const net = new Map<UserId, bigint>(people.map((userId) => [userId, 0n]));
  for (const { userId, amount } of payers) net.set(userId, net.get(userId)! + BigInt(amount));
  for (const { userId, amount } of shares) net.set(userId, net.get(userId)! - BigInt(amount));

  const creditors = people.filter((userId) => net.get(userId)! > 0n);
  const debtors = people.filter((userId) => net.get(userId)! < 0n);
  if (creditors.length === 0) return [];

  const excess = creditors.map((userId) => net.get(userId)!);
  const owed = debtors.map((userId) => -net.get(userId)!);
  const excessTotal = excess.reduce((a, b) => a + b, 0n);

  const floors = owed.map((debt) => excess.map((ex) => (debt * ex) / excessTotal));
  const remainders = owed.map((debt) => excess.map((ex) => (debt * ex) % excessTotal));
  const rowNeed = owed.map((debt, d) => debt - floors[d]!.reduce((a, b) => a + b, 0n));
  const colNeed = excess.map((ex, c) => ex - floors.reduce((acc, row) => acc + row[c]!, 0n));
  const extra = owed.map(() => excess.map(() => false));

  // Greedy pass: largest remainders first, ties by debtor then creditor order.
  const cells: { d: number; c: number; remainder: bigint }[] = [];
  remainders.forEach((row, d) =>
    row.forEach((remainder, c) => {
      if (remainder > 0n) cells.push({ d, c, remainder });
    }),
  );
  cells.sort((a, b) => (a.remainder !== b.remainder ? (a.remainder > b.remainder ? -1 : 1) : a.d - b.d || a.c - b.c));
  for (const { d, c } of cells) {
    if (rowNeed[d]! > 0n && colNeed[c]! > 0n) {
      extra[d]![c] = true;
      rowNeed[d] = rowNeed[d]! - 1n;
      colNeed[c] = colNeed[c]! - 1n;
    }
  }

  // Repair pass: route each remaining unit along an augmenting path
  // (debtor → creditor on an unused fractional cell, creditor → debtor by moving an assigned unit).
  for (;;) {
    const starts = rowNeed.flatMap((need, d) => (need > 0n ? [d] : []));
    if (starts.length === 0) break;
    const viaRow = new Map<number, number>(); // creditor ← debtor that gives it a new unit
    const viaCol = new Map<number, number>(); // debtor ← creditor it gives up a unit to
    const seenRows = new Set(starts);
    const queue = [...starts];
    let target = -1;
    search: while (queue.length > 0) {
      const d = queue.shift()!;
      for (let c = 0; c < creditors.length; c += 1) {
        if (remainders[d]![c]! === 0n || extra[d]![c] || viaRow.has(c)) continue;
        viaRow.set(c, d);
        if (colNeed[c]! > 0n) {
          target = c;
          break search;
        }
        for (let d2 = 0; d2 < debtors.length; d2 += 1) {
          if (extra[d2]![c] && !seenRows.has(d2)) {
            seenRows.add(d2);
            viaCol.set(d2, c);
            queue.push(d2);
          }
        }
      }
    }
    if (target < 0) throw new AccountingError("INTERNAL", "Could not balance pairwise rounding");

    colNeed[target] = colNeed[target]! - 1n;
    let c = target;
    for (;;) {
      const d = viaRow.get(c)!;
      extra[d]![c] = true;
      const previous = viaCol.get(d);
      if (previous === undefined) {
        rowNeed[d] = rowNeed[d]! - 1n;
        break;
      }
      extra[d]![previous] = false;
      c = previous;
    }
  }

  const debts: PairwiseDebt[] = [];
  debtors.forEach((debtorId, d) =>
    creditors.forEach((creditorId, c) => {
      const amount = floors[d]![c]! + (extra[d]![c] ? 1n : 0n);
      if (amount > 0n) debts.push({ debtorId, creditorId, amount: Number(amount) });
    }),
  );
  return debts;
}

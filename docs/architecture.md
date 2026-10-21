# Architecture: money and accounting engine

This document records the accounting rules implemented in M1. The code is pure TypeScript with no I/O:

| Module | Responsibility |
| --- | --- |
| `src/lib/money` | Currency table, amount guards, parsing, formatting |
| `src/lib/accounting` | Splits, rounding, itemized bills, pairwise debts, ledger entries, balances, idempotency keys |
| `src/lib/settlements` | Debt simplification, settlement lifecycle |

The TypeScript accounting module is the **only** implementation of split and pairwise-allocation logic (SPEC §6). Server Actions run it on the server; the database functions (M2) only validate its output.

## Money representation

- Every amount is an integer number of **minor units** of its currency. The exponent comes from ISO 4217 via `CURRENCIES` in `src/lib/money/currencies.ts` (INR/USD/EUR/GBP 2, JPY/KRW/VND 0, KWD/BHD/OMR/JOD/TND 3). Code never assumes 2 decimals.
- Amounts are JavaScript `number`s restricted to safe integers (`Number.isSafeInteger`). They are not JS `bigint`, because `bigint` cannot be JSON-serialized or passed from Server to Client Components.
- **Maximum amount:** `MAX_MINOR_AMOUNT = Number.MAX_SAFE_INTEGER = 9,007,199,254,740,991` minor units. For INR that is ₹9,00,71,99,25,47,409.91. Postgres `bigint` (max ≈ 9.2 × 10¹⁸) holds it comfortably.
- Intermediate products (amount × basis points, amount × weight, itemized fractions) can exceed 2⁵³, so the rounding code uses `bigint` **internally** and converts back to `number` only after the result is known to be safe. Sums of balances use `addMinor`, which throws on overflow rather than losing precision.
- Floating point is never used for money:
  - `parseMoney("1,23,456.78", "INR")` parses with string and `bigint` arithmetic only. It accepts Indian or international comma grouping. Extra decimals are rejected (`TOO_MANY_DECIMALS`) unless they are trailing zeros. Signs, symbols and exponents are rejected.
  - `formatMoney` passes an exact decimal string to `Intl.NumberFormat`. The default locale is `en-IN`.
- Percentages are integer **basis points** (10,000 = 100%). Weighted shares are positive integers.

## Sign convention

Positive balance = others owe this person. Negative balance = this person owes. The same convention applies in code, the database, the UI and tests.

## Rounding: largest remainder method

`roundShares(exact, denominator, total)` in `src/lib/accounting/rounding.ts` is the single rounding primitive:

1. Each participant's exact share is `numerator / denominator`, and the numerators sum to `total × denominator`.
2. Everyone gets the floor.
3. The leftover minor units (always fewer than the number of participants) go one at a time to the largest fractional remainders.
4. Ties go to the earlier participant in entry order; user ID is the final fallback.

The output keeps input order. Each share carries `roundingUnit: 0 | 1` so the UI can show who received a rounding unit. Zero-weight (excluded) participants never receive one.

Examples: ₹100 ÷ 3 → 3334 / 3333 / 3333 paise. ¥100 ÷ 3 → 34 / 33 / 33.

Split methods (`src/lib/accounting/splits.ts`):

| Method | Input | Rule |
| --- | --- | --- |
| `equal` | user IDs | weight 1 each; unlisted members owe nothing |
| `exact` | amount per user | must sum to the total; 0 allowed; no rounding |
| `percentage` | basis points per user | integers 0–10,000 summing to exactly 10,000; 0 bps = excluded |
| `shares` | positive integer weight per user | proportional |

## Itemized bills, tax, tip, service charge, discounts

`splitItemized` in `src/lib/accounting/itemized.ts` keeps everything as exact fractions over one common denominator and rounds **once**, at the end:

1. Each item is split among its assignees by weight (default 1 = equal). Summing over items gives each person's exact pre-tax subtotal `sᵢ`. The items total is `S = Σ sᵢ`.
2. Tax, service charge and tip each add `A × sᵢ / S` (proportional, the default) or `A / n` (the `equal` override, split among everyone on the bill).
3. Discounts subtract the same way. Total discounts may not exceed `S`. If an equal discount would make anyone's share negative, the split is rejected (`NEGATIVE_SHARE`).
4. The bill total is `S + charges − discounts`. The exact shares are rounded with the largest remainder method, so the final shares sum to the bill total exactly.

Rounding only once avoids the drift that per-item or per-charge rounding would add up.

## Multi-payer expenses and pairwise debts

The ledger is **pairwise** (SPEC §6). `allocatePairwise(payers, shares)` in `src/lib/accounting/pairwise.ts`:

1. `netᵢ = paidᵢ − shareᵢ`. Creditors have net > 0; debtors have net < 0.
2. Each debtor's debt is allocated to the creditors in proportion to each creditor's excess payment: `|net_d| × net_c / Σ creditor nets`.
3. The whole debtor × creditor matrix is rounded together, not row by row. Rounding each row on its own can overpay a creditor (two debtors each owing 1 unit to two equal creditors would both pay the first). The steps:
   - Every cell gets its floor.
   - Leftover units go to cells with the largest remainders (ties: debtor order, then creditor order), as long as both that debtor and that creditor still need a unit.
   - Any unit the greedy pass cannot place is routed along a deterministic augmenting path. An integral solution always exists, because the fractional matrix is itself a feasible flow.

   The result: every debtor pays exactly their net debt, every creditor receives exactly their excess, and each cell is within one unit of its exact value.
4. A single-payer expense never needs rounding: everyone simply owes the payer their share.

Example (SPEC §7): A pays ₹600 and B pays ₹300 for a ₹900 bill split equally among A, B and C. Nets are A +300, B 0, C −300, so the only entry is C → A ₹300.

## Ledger entries, edits and cancellations

`src/lib/accounting/ledger.ts` produces append-only `LedgerEntry` rows:

```
{ debtorId, creditorId, amount > 0, currency, groupId | null,
  source: { kind: "expense" | "settlement", id, version }, entryType: "charge" | "reversal" }
```

- **Expense:** charge entries from `allocatePairwise`, linked to the expense and its version.
- **Edit:** `amendExpenseEntries(current, next)` returns reversals of the current version's charges plus charges for version `current + 1`. A reversal swaps debtor and creditor, so amounts stay positive.
- **Cancel:** `cancelExpenseEntries(current)` returns reversals only.
- **Settlement:** one entry only when `completed`. Its direction is opposite to the debt (`debtorId = receiver`, `creditorId = payer`), so the payer's debt decreases. Pending, rejected and cancelled settlements have no entries. Cancelling a completed settlement writes its reversal.

## Balances

`src/lib/accounting/balances.ts` derives every balance from the ledger. Nothing is stored as a running total.

| Function | Result |
| --- | --- |
| `netBalances(entries)` | per user and currency |
| `groupBalances(entries, groupId)` | one group; `null` = direct expenses |
| `pairBalances(entries, userId)` | friend view: raw pairwise totals with each counterparty across all groups and direct expenses, per currency |
| `pairBalance(entries, a, b)` | one pair, per currency |

Currencies are never mixed. Zero balances are omitted. Output is sorted, so it is deterministic. Within any group, balances sum to zero per currency; property tests check this.

## Debt simplification

`simplifyDebts(balances)` in `src/lib/settlements/simplify.ts` is a deterministic greedy algorithm:

1. Group by currency. Reject input whose currency doesn't sum to zero.
2. Repeatedly match the largest creditor with the largest debtor (ties by user ID) and transfer the smaller of the two amounts.

Each step clears at least one person, so it produces at most n − 1 transfers for n non-zero members, and every net balance is preserved exactly. Finding the true minimum number of transfers is NP-hard, so the UI calls the result **"simplified"**, never "optimal". Friend views use raw pairwise entries; only the group view (with "simplify debts" on) shows simplified transfers.

## Settlement lifecycle

`src/lib/settlements/lifecycle.ts` (SPEC §2, §11):

| From | Action | Who | To | Ledger |
| --- | --- | --- | --- | --- |
| (new) | record | receiver | completed | apply |
| (new) | record | payer | pending | none |
| pending | confirm | receiver | completed | apply |
| pending | reject | receiver | rejected | none |
| pending | cancel | payer (withdraw) | cancelled | none |
| completed | cancel | either | cancelled | reverse |

Rejected and cancelled are final. Completing twice is an invalid transition, so a settlement is never counted twice. The database (M2) enforces the same rules, plus idempotency-key uniqueness.

## Idempotency

`createIdempotencyKey()` generates a UUID v4 on the client. Retries reuse the same key, and the database's unique constraint (per creator) turns a duplicate submission into a no-op. Ledger construction is deterministic, so a retried request always produces identical rows.

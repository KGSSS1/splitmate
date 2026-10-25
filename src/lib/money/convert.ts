import { addMinor } from "./amount";
import { getCurrency, isCurrencyCode } from "./currencies";

/**
 * Approximate conversion between currencies, for display only (SPEC §13): an
 * "about this much in INR" figure next to balances that stay in their own
 * currencies. Stored amounts are never converted or rewritten.
 *
 * Rates arrive as exact decimal strings (`exchange_rates.rate`, units of
 * `quote` per one `base`). The arithmetic is done on BigInt fractions and
 * rounded once, half away from zero, so no floating point touches money.
 */

/** One stored rate, as `latest_exchange_rates()` returns it. */
export interface ExchangeRate {
  provider: string;
  base: string;
  quote: string;
  /** Decimal string, e.g. "106.2720000000". */
  rate: string;
  /** The day the provider published the rate (YYYY-MM-DD). */
  rateDate: string;
}

interface Decimal {
  units: bigint;
  scale: number;
}

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** "106.272" → 106272 × 10⁻³; null for anything that isn't a positive plain decimal. */
export function parseRate(value: string): Decimal | null {
  const match = DECIMAL.exec(value.trim());
  if (!match) return null;
  const fraction = match[2] ?? "";
  const units = BigInt(`${match[1]}${fraction}`);
  return units > 0n ? { units, scale: fraction.length } : null;
}

const pow10 = (exponent: number) => 10n ** BigInt(exponent);

/** Rates by currency against one base currency (the base itself is 1). */
export interface RateTable {
  base: string;
  rates: Map<string, Decimal>;
  /** The oldest publication date among the rates used, for the label. */
  rateDate: string | null;
  provider: string | null;
}

/**
 * A rate table from stored rates. Rates against a different base than the
 * first one, unknown currencies and malformed rates are ignored.
 */
export function rateTable(rows: readonly ExchangeRate[]): RateTable | null {
  const base = rows[0]?.base;
  if (!base || !isCurrencyCode(base)) return null;
  const rates = new Map<string, Decimal>([[base, { units: 1n, scale: 0 }]]);
  let rateDate: string | null = null;
  for (const row of rows) {
    if (row.base !== base || !isCurrencyCode(row.quote)) continue;
    const parsed = parseRate(row.rate);
    if (!parsed) continue;
    rates.set(row.quote, parsed);
    if (rateDate === null || row.rateDate < rateDate) rateDate = row.rateDate;
  }
  return { base, rates, rateDate, provider: rows[0]?.provider ?? null };
}

/** Integer division rounded half away from zero. */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const negative = numerator < 0n !== denominator < 0n;
  const twice = (remainder < 0n ? -remainder : remainder) * 2n;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  if (twice >= absDenominator) return negative ? quotient - 1n : quotient + 1n;
  return quotient;
}

/**
 * `amount` (minor units of `from`) in minor units of `to`, or null when either
 * currency has no rate. Exponents differ per currency (JPY 0, INR 2, KWD 3).
 */
export function convertMinor(amount: number, from: string, to: string, table: RateTable): number | null {
  if (!Number.isSafeInteger(amount)) throw new RangeError("Amount must be a safe integer");
  if (from === to) return amount;
  const fromRate = table.rates.get(from);
  const toRate = table.rates.get(to);
  if (!fromRate || !toRate) return null;
  const shift = getCurrency(to).exponent - getCurrency(from).exponent;
  // amount × (to per base) / (from per base), with both decimals' scales and the exponent shift.
  const numerator = BigInt(amount) * toRate.units * pow10(fromRate.scale) * pow10(Math.max(0, shift));
  const denominator = fromRate.units * pow10(toRate.scale) * pow10(Math.max(0, -shift));
  const result = divideRounded(numerator, denominator);
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(-Number.MAX_SAFE_INTEGER)) return null;
  return Number(result);
}

export interface ApproximateTotal {
  currency: string;
  owedToYou: number;
  youOwe: number;
  net: number;
  /** Currencies that were converted (or already in `currency`). */
  included: string[];
  /** Currencies left out because no rate is stored for them. */
  missing: string[];
  rateDate: string | null;
  provider: string | null;
}

/**
 * Owed / owing per currency, each converted to `target` and added up. Owed and
 * owing are converted separately, then netted, so the three figures agree.
 */
export function approximateTotal(
  summaries: readonly { currency: string; owedToYou: number; youOwe: number }[],
  target: string,
  table: RateTable | null,
): ApproximateTotal {
  const total: ApproximateTotal = {
    currency: target,
    owedToYou: 0,
    youOwe: 0,
    net: 0,
    included: [],
    missing: [],
    rateDate: table?.rateDate ?? null,
    provider: table?.provider ?? null,
  };
  for (const summary of summaries) {
    const owed = table ? convertMinor(summary.owedToYou, summary.currency, target, table) : summary.currency === target ? summary.owedToYou : null;
    const owe = table ? convertMinor(summary.youOwe, summary.currency, target, table) : summary.currency === target ? summary.youOwe : null;
    if (owed === null || owe === null) {
      total.missing.push(summary.currency);
      continue;
    }
    total.owedToYou = addMinor(total.owedToYou, owed);
    total.youOwe = addMinor(total.youOwe, owe);
    total.included.push(summary.currency);
  }
  total.net = addMinor(total.owedToYou, -total.youOwe);
  return total;
}

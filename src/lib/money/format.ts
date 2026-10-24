import { assertMinorAmount } from "./amount";
import { getCurrency } from "./currencies";

export const DEFAULT_LOCALE = "en-IN";

/** Exact decimal string for a minor-unit amount: 12345 INR → "123.45", 1500 JPY → "1500". */
export function minorToDecimalString(minor: number, currency: string): string {
  assertMinorAmount(minor, { allowZero: true, allowNegative: true });
  const { exponent } = getCurrency(currency);
  const sign = minor < 0 ? "-" : "";
  const digits = Math.abs(minor).toString().padStart(exponent + 1, "0");
  if (exponent === 0) return sign + digits;
  return `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

export interface FormatMoneyOptions {
  locale?: string;
  signDisplay?: Intl.NumberFormatOptions["signDisplay"];
}

/**
 * Locale-aware currency formatting (default en-IN: ₹1,23,456.78). The amount is
 * passed to Intl as an exact decimal string, so large values never go through floats.
 */
export function formatMoney(minor: number, currency: string, options: FormatMoneyOptions = {}): string {
  const { exponent, code } = getCurrency(currency);
  const formatter = new Intl.NumberFormat(options.locale ?? DEFAULT_LOCALE, {
    style: "currency",
    currency: code,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
    signDisplay: options.signDisplay ?? "auto",
  });
  return formatter.format(minorToDecimalString(minor, currency) as Intl.StringNumericLiteral);
}

/**
 * Short form for chart axes and labels: ₹1.2K, ₹3.4L (en-IN), $12M. Rounded for
 * display only, from the exact decimal string; never use it for stored amounts.
 */
export function formatMoneyCompact(minor: number, currency: string, locale = DEFAULT_LOCALE): string {
  const { code } = getCurrency(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(minorToDecimalString(minor, currency) as Intl.StringNumericLiteral);
}

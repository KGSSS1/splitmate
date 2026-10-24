import { MoneyError } from "./errors";

/**
 * Supported ISO 4217 currencies. `exponent` is the number of minor-unit digits
 * (INR 2 → paise, JPY 0, KWD 3). Never assume 2 decimals.
 */
export interface Currency {
  code: string;
  exponent: 0 | 2 | 3;
  name: string;
  /**
   * The largest amount one expense may have, in major units (SPEC §7): about
   * US$100,000, rounded per currency. Mirrored in the database
   * (`private.currency_max_amount`); a test keeps the two in sync.
   */
  maxExpense: number;
}

const define = <T extends Record<string, Currency>>(table: { [K in keyof T]: T[K] & { code: K } }) => table;

export const CURRENCIES = define({
  INR: { code: "INR", exponent: 2, name: "Indian Rupee", maxExpense: 10_000_000 },
  USD: { code: "USD", exponent: 2, name: "US Dollar", maxExpense: 100_000 },
  EUR: { code: "EUR", exponent: 2, name: "Euro", maxExpense: 100_000 },
  GBP: { code: "GBP", exponent: 2, name: "Pound Sterling", maxExpense: 100_000 },
  AED: { code: "AED", exponent: 2, name: "UAE Dirham", maxExpense: 500_000 },
  AUD: { code: "AUD", exponent: 2, name: "Australian Dollar", maxExpense: 200_000 },
  BDT: { code: "BDT", exponent: 2, name: "Bangladeshi Taka", maxExpense: 10_000_000 },
  BRL: { code: "BRL", exponent: 2, name: "Brazilian Real", maxExpense: 500_000 },
  CAD: { code: "CAD", exponent: 2, name: "Canadian Dollar", maxExpense: 200_000 },
  CHF: { code: "CHF", exponent: 2, name: "Swiss Franc", maxExpense: 100_000 },
  CNY: { code: "CNY", exponent: 2, name: "Chinese Yuan", maxExpense: 1_000_000 },
  CZK: { code: "CZK", exponent: 2, name: "Czech Koruna", maxExpense: 2_500_000 },
  DKK: { code: "DKK", exponent: 2, name: "Danish Krone", maxExpense: 1_000_000 },
  EGP: { code: "EGP", exponent: 2, name: "Egyptian Pound", maxExpense: 5_000_000 },
  HKD: { code: "HKD", exponent: 2, name: "Hong Kong Dollar", maxExpense: 1_000_000 },
  IDR: { code: "IDR", exponent: 2, name: "Indonesian Rupiah", maxExpense: 2_000_000_000 },
  ILS: { code: "ILS", exponent: 2, name: "Israeli New Shekel", maxExpense: 500_000 },
  KES: { code: "KES", exponent: 2, name: "Kenyan Shilling", maxExpense: 15_000_000 },
  LKR: { code: "LKR", exponent: 2, name: "Sri Lankan Rupee", maxExpense: 30_000_000 },
  MXN: { code: "MXN", exponent: 2, name: "Mexican Peso", maxExpense: 2_000_000 },
  MYR: { code: "MYR", exponent: 2, name: "Malaysian Ringgit", maxExpense: 500_000 },
  NGN: { code: "NGN", exponent: 2, name: "Nigerian Naira", maxExpense: 150_000_000 },
  NOK: { code: "NOK", exponent: 2, name: "Norwegian Krone", maxExpense: 1_000_000 },
  NPR: { code: "NPR", exponent: 2, name: "Nepalese Rupee", maxExpense: 15_000_000 },
  NZD: { code: "NZD", exponent: 2, name: "New Zealand Dollar", maxExpense: 200_000 },
  PHP: { code: "PHP", exponent: 2, name: "Philippine Peso", maxExpense: 5_000_000 },
  PKR: { code: "PKR", exponent: 2, name: "Pakistani Rupee", maxExpense: 30_000_000 },
  PLN: { code: "PLN", exponent: 2, name: "Polish Zloty", maxExpense: 500_000 },
  QAR: { code: "QAR", exponent: 2, name: "Qatari Riyal", maxExpense: 500_000 },
  SAR: { code: "SAR", exponent: 2, name: "Saudi Riyal", maxExpense: 500_000 },
  SEK: { code: "SEK", exponent: 2, name: "Swedish Krona", maxExpense: 1_000_000 },
  SGD: { code: "SGD", exponent: 2, name: "Singapore Dollar", maxExpense: 150_000 },
  THB: { code: "THB", exponent: 2, name: "Thai Baht", maxExpense: 4_000_000 },
  TRY: { code: "TRY", exponent: 2, name: "Turkish Lira", maxExpense: 4_000_000 },
  TWD: { code: "TWD", exponent: 2, name: "New Taiwan Dollar", maxExpense: 3_000_000 },
  ZAR: { code: "ZAR", exponent: 2, name: "South African Rand", maxExpense: 2_000_000 },
  CLP: { code: "CLP", exponent: 0, name: "Chilean Peso", maxExpense: 100_000_000 },
  ISK: { code: "ISK", exponent: 0, name: "Icelandic Króna", maxExpense: 15_000_000 },
  JPY: { code: "JPY", exponent: 0, name: "Japanese Yen", maxExpense: 15_000_000 },
  KRW: { code: "KRW", exponent: 0, name: "South Korean Won", maxExpense: 150_000_000 },
  UGX: { code: "UGX", exponent: 0, name: "Ugandan Shilling", maxExpense: 400_000_000 },
  VND: { code: "VND", exponent: 0, name: "Vietnamese Dong", maxExpense: 2_500_000_000 },
  BHD: { code: "BHD", exponent: 3, name: "Bahraini Dinar", maxExpense: 50_000 },
  JOD: { code: "JOD", exponent: 3, name: "Jordanian Dinar", maxExpense: 100_000 },
  KWD: { code: "KWD", exponent: 3, name: "Kuwaiti Dinar", maxExpense: 50_000 },
  OMR: { code: "OMR", exponent: 3, name: "Omani Rial", maxExpense: 50_000 },
  TND: { code: "TND", exponent: 3, name: "Tunisian Dinar", maxExpense: 300_000 },
});

export type CurrencyCode = keyof typeof CURRENCIES;

export const DEFAULT_CURRENCY: CurrencyCode = "INR";

export function isCurrencyCode(code: string): code is CurrencyCode {
  return Object.hasOwn(CURRENCIES, code);
}

/** The largest amount one expense may have in `code`, in minor units. */
export function maxExpenseMinor(code: string): number {
  const { maxExpense, exponent } = getCurrency(code);
  return maxExpense * 10 ** exponent;
}

export function getCurrency(code: string): Currency {
  if (!isCurrencyCode(code)) {
    throw new MoneyError("UNKNOWN_CURRENCY", `Unsupported currency: ${code}`);
  }
  return CURRENCIES[code];
}

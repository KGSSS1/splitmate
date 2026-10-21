import { MoneyError } from "./errors";

/**
 * Supported ISO 4217 currencies. `exponent` is the number of minor-unit digits
 * (INR 2 → paise, JPY 0, KWD 3). Never assume 2 decimals.
 */
export interface Currency {
  code: string;
  exponent: 0 | 2 | 3;
  name: string;
}

const define = <T extends Record<string, Currency>>(table: { [K in keyof T]: T[K] & { code: K } }) => table;

export const CURRENCIES = define({
  INR: { code: "INR", exponent: 2, name: "Indian Rupee" },
  USD: { code: "USD", exponent: 2, name: "US Dollar" },
  EUR: { code: "EUR", exponent: 2, name: "Euro" },
  GBP: { code: "GBP", exponent: 2, name: "Pound Sterling" },
  AED: { code: "AED", exponent: 2, name: "UAE Dirham" },
  AUD: { code: "AUD", exponent: 2, name: "Australian Dollar" },
  BDT: { code: "BDT", exponent: 2, name: "Bangladeshi Taka" },
  BRL: { code: "BRL", exponent: 2, name: "Brazilian Real" },
  CAD: { code: "CAD", exponent: 2, name: "Canadian Dollar" },
  CHF: { code: "CHF", exponent: 2, name: "Swiss Franc" },
  CNY: { code: "CNY", exponent: 2, name: "Chinese Yuan" },
  CZK: { code: "CZK", exponent: 2, name: "Czech Koruna" },
  DKK: { code: "DKK", exponent: 2, name: "Danish Krone" },
  EGP: { code: "EGP", exponent: 2, name: "Egyptian Pound" },
  HKD: { code: "HKD", exponent: 2, name: "Hong Kong Dollar" },
  IDR: { code: "IDR", exponent: 2, name: "Indonesian Rupiah" },
  ILS: { code: "ILS", exponent: 2, name: "Israeli New Shekel" },
  KES: { code: "KES", exponent: 2, name: "Kenyan Shilling" },
  LKR: { code: "LKR", exponent: 2, name: "Sri Lankan Rupee" },
  MXN: { code: "MXN", exponent: 2, name: "Mexican Peso" },
  MYR: { code: "MYR", exponent: 2, name: "Malaysian Ringgit" },
  NGN: { code: "NGN", exponent: 2, name: "Nigerian Naira" },
  NOK: { code: "NOK", exponent: 2, name: "Norwegian Krone" },
  NPR: { code: "NPR", exponent: 2, name: "Nepalese Rupee" },
  NZD: { code: "NZD", exponent: 2, name: "New Zealand Dollar" },
  PHP: { code: "PHP", exponent: 2, name: "Philippine Peso" },
  PKR: { code: "PKR", exponent: 2, name: "Pakistani Rupee" },
  PLN: { code: "PLN", exponent: 2, name: "Polish Zloty" },
  QAR: { code: "QAR", exponent: 2, name: "Qatari Riyal" },
  SAR: { code: "SAR", exponent: 2, name: "Saudi Riyal" },
  SEK: { code: "SEK", exponent: 2, name: "Swedish Krona" },
  SGD: { code: "SGD", exponent: 2, name: "Singapore Dollar" },
  THB: { code: "THB", exponent: 2, name: "Thai Baht" },
  TRY: { code: "TRY", exponent: 2, name: "Turkish Lira" },
  TWD: { code: "TWD", exponent: 2, name: "New Taiwan Dollar" },
  ZAR: { code: "ZAR", exponent: 2, name: "South African Rand" },
  CLP: { code: "CLP", exponent: 0, name: "Chilean Peso" },
  ISK: { code: "ISK", exponent: 0, name: "Icelandic Króna" },
  JPY: { code: "JPY", exponent: 0, name: "Japanese Yen" },
  KRW: { code: "KRW", exponent: 0, name: "South Korean Won" },
  UGX: { code: "UGX", exponent: 0, name: "Ugandan Shilling" },
  VND: { code: "VND", exponent: 0, name: "Vietnamese Dong" },
  BHD: { code: "BHD", exponent: 3, name: "Bahraini Dinar" },
  JOD: { code: "JOD", exponent: 3, name: "Jordanian Dinar" },
  KWD: { code: "KWD", exponent: 3, name: "Kuwaiti Dinar" },
  OMR: { code: "OMR", exponent: 3, name: "Omani Rial" },
  TND: { code: "TND", exponent: 3, name: "Tunisian Dinar" },
});

export type CurrencyCode = keyof typeof CURRENCIES;

export const DEFAULT_CURRENCY: CurrencyCode = "INR";

export function isCurrencyCode(code: string): code is CurrencyCode {
  return Object.hasOwn(CURRENCIES, code);
}

export function getCurrency(code: string): Currency {
  if (!isCurrencyCode(code)) {
    throw new MoneyError("UNKNOWN_CURRENCY", `Unsupported currency: ${code}`);
  }
  return CURRENCIES[code];
}

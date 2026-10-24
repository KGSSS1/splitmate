/** A CSV cell: text, or null for an empty cell. Amounts arrive as exact decimal strings. */
export type CsvValue = string | null;

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
/** Leading characters a spreadsheet may run as a formula (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One cell per RFC 4180. Text that a spreadsheet would treat as a formula gets
 * a leading apostrophe; plain numbers such as "-12.50" are left as they are.
 */
export function csvCell(value: CsvValue): string {
  if (value === null) return "";
  const safe = !PLAIN_NUMBER.test(value) && FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * A whole CSV document: header row, then rows, CRLF line endings. Starts with
 * a byte-order mark so spreadsheet apps read it as UTF-8 (₹, names).
 */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

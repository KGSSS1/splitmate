import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CURRENCIES, maxExpenseMinor } from "@/lib/money/currencies";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** The currency list in the latest migration that defines the currency_code_supported check. */
function sqlCurrencyCodes(): string[] {
  const pattern = /currency_code_supported\s+check\s*\(\s*value\s+in\s*\(([^)]*)\)/i;
  let codes: string[] | undefined;
  for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
    const match = pattern.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    if (match) codes = [...match[1]!.matchAll(/'([A-Z]{3})'/g)].map((m) => m[1]!);
  }
  if (!codes) throw new Error("No currency_code_supported constraint found in supabase/migrations");
  return codes;
}

describe("currency list", () => {
  it("is the same in TypeScript and in the database", () => {
    expect([...sqlCurrencyCodes()].sort()).toEqual(Object.keys(CURRENCIES).sort());
  });
});

/** The per-currency maximum in the latest migration that defines private.currency_max_amount. */
function sqlMaxAmounts(): Map<string, number> {
  let block: string | undefined;
  for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const match = /function private\.currency_max_amount[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(sql);
    if (match) block = match[1];
  }
  if (!block) throw new Error("No private.currency_max_amount function found in supabase/migrations");
  return new Map([...block.matchAll(/\('([A-Z]{3})',\s*(\d+)::bigint\)/g)].map((m) => [m[1]!, Number(m[2])]));
}

describe("maximum expense amount", () => {
  it("is the same in TypeScript and in the database, for every currency", () => {
    const sql = sqlMaxAmounts();
    expect([...sql.keys()].sort()).toEqual(Object.keys(CURRENCIES).sort());
    for (const code of Object.keys(CURRENCIES)) expect(sql.get(code), code).toBe(maxExpenseMinor(code));
  });

  it("is a safe integer in minor units everywhere", () => {
    for (const code of Object.keys(CURRENCIES)) expect(Number.isSafeInteger(maxExpenseMinor(code)), code).toBe(true);
  });
});

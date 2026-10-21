import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CURRENCIES } from "@/lib/money/currencies";

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

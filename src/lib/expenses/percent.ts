import { FULL_PERCENT_BPS } from "@/lib/accounting/splits";

/**
 * Parses a percentage typed by the user ("33.33", "50", "12.5") into integer
 * basis points (SPEC §7: 100% = 10,000) with string arithmetic only. At most
 * two decimals; 0–100. Returns null for anything else.
 */
export function parsePercent(input: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(input.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const basisPoints = whole * 100 + fraction;
  return basisPoints <= FULL_PERCENT_BPS ? basisPoints : null;
}

/** 3333 → "33.33", 5000 → "50", 1250 → "12.5". */
export function formatBasisPoints(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = (basisPoints % 100).toString().padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

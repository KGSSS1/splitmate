import "server-only";

import { type ExchangeRate, type RateTable, rateTable } from "@/lib/money/convert";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * The newest stored rate per currency (fetched daily by the database from
 * Frankfurter). Never throws: without rates the dashboard simply shows no
 * converted total, and nothing else depends on them (SPEC §13).
 */
export async function loadRateTable(supabase: Client): Promise<RateTable | null> {
  try {
    const { data, error } = await supabase.rpc("latest_exchange_rates");
    if (error || data.length === 0) return null;
    return rateTable(
      data.map(
        (row): ExchangeRate => ({
          provider: row.provider,
          base: row.base,
          quote: row.quote,
          rate: row.rate,
          rateDate: row.rate_date,
        }),
      ),
    );
  } catch {
    return null;
  }
}

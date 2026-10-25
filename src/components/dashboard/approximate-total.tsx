import { Info } from "lucide-react";

import { formatExpenseDate } from "@/lib/expenses/dates";
import type { ApproximateTotal } from "@/lib/money/convert";
import { formatMoney } from "@/lib/money/format";

const PROVIDER_NAMES: Record<string, string> = { frankfurter: "Frankfurter" };

/**
 * Balances in other currencies converted into the viewer's default currency, as
 * one approximate figure (SPEC §13). It is display only and labelled so: the
 * balances themselves stay in their own currencies, and settling up always
 * uses them.
 */
export function ApproximateTotalCard({ total }: { total: ApproximateTotal | null }) {
  if (total === null) {
    return (
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        An approximate total in one currency isn&apos;t available right now (no exchange rates yet). Your balances
        above are exact.
      </p>
    );
  }
  const { currency } = total;
  const provider = total.provider ? (PROVIDER_NAMES[total.provider] ?? total.provider) : null;
  const source = [
    provider ? `${provider}'s ECB reference rates` : "stored rates",
    total.rateDate ? `from ${formatExpenseDate(total.rateDate)}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <section
      aria-labelledby="approximate-heading"
      className="grid gap-2 rounded-xl border border-dashed p-4 text-sm"
      data-approximate-total
    >
      <h3 id="approximate-heading" className="font-medium">
        Approximate total in {currency}
      </h3>
      <p className="tabular-nums">
        ≈ {formatMoney(total.net, currency, { signDisplay: "exceptZero" })} net{" "}
        <span className="text-muted-foreground">
          (≈ {formatMoney(total.owedToYou, currency)} owed to you, ≈ {formatMoney(total.youOwe, currency)} you owe)
        </span>
      </p>
      <p className="text-xs text-muted-foreground">
        For information only, converted at {source}. Balances stay in their own currencies, and settling up always
        uses them.
        {total.missing.length > 0 ? ` Not included (no rate): ${total.missing.join(", ")}.` : ""}
      </p>
    </section>
  );
}

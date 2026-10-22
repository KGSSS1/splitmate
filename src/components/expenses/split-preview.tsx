import { CircleAlert } from "lucide-react";

import type { ResolveResult } from "@/lib/expenses/resolve";
import { formatMoney } from "@/lib/money/format";

/**
 * Live result of the split as the form stands (SPEC §10): each person's share,
 * who received a rounding unit, who will owe whom, and — while the split is
 * not valid — what still needs fixing before it can be saved.
 */
export function SplitPreview({
  result,
  currency,
  nameOf,
}: {
  result: ResolveResult;
  currency: string;
  nameOf: (id: string) => string;
}) {
  const shares = result.ok ? result.expense.shares : result.shares;
  const total = result.ok ? result.expense.total : result.total;
  const format = (amount: number) => formatMoney(amount, currency);
  const anyRounding = shares?.some((share) => share.roundingUnit === 1) ?? false;

  return (
    <section aria-labelledby="split-preview-heading" aria-live="polite" className="grid gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="split-preview-heading" className="font-semibold">
          Preview
        </h2>
        {total !== null ? (
          <p className="text-sm text-muted-foreground">
            Total <span className="font-medium text-foreground tabular-nums">{format(total)}</span>
          </p>
        ) : null}
      </div>

      {shares && shares.length > 0 ? (
        <ul className="grid gap-1.5" aria-label="Shares">
          {shares.map((share) => (
            <li key={share.userId} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{nameOf(share.userId)}</span>
              <span className="flex items-center gap-1.5 tabular-nums">
                {share.roundingUnit === 1 ? (
                  <span
                    title="Received a rounding unit"
                    className="inline-flex items-center rounded-full bg-muted px-1.5 text-[0.7rem] text-muted-foreground"
                  >
                    +1<span className="sr-only"> rounding unit</span>
                  </span>
                ) : null}
                {format(share.amount)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {total === null
            ? "Enter an amount and choose who's in to see each share."
            : "Each share appears once the split adds up."}
        </p>
      )}
      {anyRounding ? (
        <p className="text-xs text-muted-foreground">
          The total can&apos;t be divided evenly, so the leftover units (marked +1) went to the largest remainders.
        </p>
      ) : null}

      {result.ok && result.expense.debts.length > 0 ? (
        <div className="grid gap-1.5 border-t pt-3">
          <h3 className="text-sm font-medium">Who owes whom</h3>
          <ul className="grid gap-1 text-sm" aria-label="Who owes whom">
            {result.expense.debts.map((debt) => (
              <li key={`${debt.debtorId}>${debt.creditorId}`} className="tabular-nums">
                {nameOf(debt.debtorId)} owes {nameOf(debt.creditorId)} {format(debt.amount)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!result.ok ? (
        <div role="status" className="grid gap-1.5 rounded-lg border border-destructive/30 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <CircleAlert aria-hidden className="size-4 text-destructive" />
            Before you can save
          </p>
          <ul className="grid list-disc gap-0.5 pl-6 text-muted-foreground">
            {[...new Set(result.issues.map((issue) => issue.message))].map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

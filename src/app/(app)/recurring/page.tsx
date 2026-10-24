import { Plus, Repeat } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { RecurringStatusBadge } from "@/components/recurring/recurring-status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ROW_LINK_CLASS } from "@/components/shared/row-link";
import { buttonVariants } from "@/components/ui/button";
import { ROUTES } from "@/lib/auth/routes";
import { formatExpenseDate } from "@/lib/expenses/dates";
import { formatMoney } from "@/lib/money/format";
import { FREQUENCY_LABELS } from "@/lib/recurring/schedule";
import { cn } from "@/lib/utils";
import { requireOnboardedProfile } from "@/server/auth";
import { listRecurring } from "@/server/recurring";

export const metadata: Metadata = { title: "Recurring expenses" };

/** Every recurring expense the viewer can see: rent, subscriptions, anything on a schedule (SPEC §12). */
export default async function RecurringPage() {
  await requireOnboardedProfile();
  const items = await listRecurring();

  return (
    <div className="grid max-w-3xl gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Recurring expenses</h1>
          <p className="text-muted-foreground">Added automatically on each date, with the split you set up.</p>
        </div>
        <Link href={`${ROUTES.newExpense}?repeat=monthly`} className={cn(buttonVariants(), "h-11 md:h-9")}>
          <Plus aria-hidden />
          Add recurring expense
        </Link>
      </header>

      {items.length === 0 ? (
        <EmptyState icon={Repeat} title="Nothing recurring yet">
          <p>Set up rent, bills or subscriptions once, and SplitMate adds each one on its date.</p>
        </EmptyState>
      ) : (
        <ul className="divide-y rounded-xl border" aria-label="Recurring expenses">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`${ROUTES.recurring}/${item.id}`}
                className={cn("flex min-h-16 items-center justify-between gap-3 px-4 py-3", ROW_LINK_CLASS)}
              >
                <span className="grid min-w-0 gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{item.description}</span>
                    {item.status === "active" ? null : <RecurringStatusBadge status={item.status} />}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {FREQUENCY_LABELS[item.frequency]} · {item.where}
                    {item.nextDate && item.status === "active" ? ` · Next ${formatExpenseDate(item.nextDate)}` : ""}
                  </span>
                </span>
                <span className="grid shrink-0 justify-items-end gap-0.5 text-right">
                  <span className="font-medium tabular-nums">{formatMoney(item.amount, item.currency)}</span>
                  {item.myShare !== null ? (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      Your share {formatMoney(item.myShare, item.currency)}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

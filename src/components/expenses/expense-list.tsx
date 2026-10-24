import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { ROUTES } from "@/lib/auth/routes";
import { formatExpenseDate } from "@/lib/expenses/dates";
import { categoryLabel } from "@/lib/expenses/options";
import { formatMoney } from "@/lib/money/format";
import { cn } from "@/lib/utils";
import type { ExpenseListItem } from "@/server/expenses";

/**
 * What the expense did for the viewer when it was added, in words. It is worded
 * and coloured unlike a balance ("you owe", red/green): it may be settled
 * already, and current balances live on the balance pages (review M5).
 */
function yourPart(item: ExpenseListItem): string {
  if (item.myNet === null) return "Not involved";
  if (item.myNet > 0) return `You lent ${formatMoney(item.myNet, item.currency)}`;
  if (item.myNet < 0) return `You borrowed ${formatMoney(-item.myNet, item.currency)}`;
  return "Your share was what you paid";
}

export function ExpenseList({ items, label }: { items: readonly ExpenseListItem[]; label: string }) {
  return (
    <ul className="divide-y rounded-xl border" aria-label={label}>
      {items.map((item) => {
        const cancelled = item.status === "cancelled";
        const part = yourPart(item);
        return (
          <li key={item.id}>
            <Link
              href={`${ROUTES.expenses}/${item.id}`}
              className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
            >
              <span className="w-14 shrink-0 text-xs text-muted-foreground">{formatExpenseDate(item.expenseDate)}</span>
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate font-medium", cancelled && "text-muted-foreground line-through")}>
                  {item.description}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {cancelled ? "Cancelled · " : ""}
                  {item.paidBy} paid {formatMoney(item.amount, item.currency)}
                  {item.category ? ` · ${categoryLabel(item.category)}` : ""}
                </span>
              </span>
              {cancelled ? null : (
                <span className="shrink-0 text-right text-sm text-muted-foreground tabular-nums">{part}</span>
              )}
              <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

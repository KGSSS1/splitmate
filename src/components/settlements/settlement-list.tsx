import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { ROUTES } from "@/lib/auth/routes";
import { formatExpenseDate } from "@/lib/expenses/dates";
import { formatMoney } from "@/lib/money/format";
import { settlementMethodLabel } from "@/lib/settlements/options";
import { cn } from "@/lib/utils";
import type { SettlementItem } from "@/server/settlements";

import { SettlementActions } from "./settlement-actions";
import { SettlementStatusBadge } from "./settlement-status-badge";

/** "You paid Bina ₹100.00", "Bina paid you ₹100.00" or "Bina paid Chetan ₹100.00". */
export function settlementSentence(item: SettlementItem, viewerId: string): string {
  const money = formatMoney(item.amount, item.currency);
  if (item.payerId === viewerId) return `You paid ${item.receiverName} ${money}`;
  if (item.receiverId === viewerId) return `${item.payerName} paid you ${money}`;
  return `${item.payerName} paid ${item.receiverName} ${money}`;
}

/**
 * Settlements with their status in words. With `showActions`, pending ones
 * the viewer must answer get Confirm and Reject buttons in the row.
 */
export function SettlementList({
  items,
  viewerId,
  label,
  showActions = false,
  showGroup = true,
}: {
  items: readonly SettlementItem[];
  viewerId: string;
  label: string;
  showActions?: boolean;
  showGroup?: boolean;
}) {
  return (
    <ul className="divide-y rounded-xl border" aria-label={label}>
      {items.map((item) => {
        const inactive = item.status === "cancelled" || item.status === "rejected";
        const answer = showActions && item.status === "pending" && item.actions.includes("confirm");
        return (
          <li key={item.id} className="grid">
            <Link
              href={`${ROUTES.settlements}/${item.id}`}
              className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
            >
              <span className="w-14 shrink-0 text-xs text-muted-foreground">{formatExpenseDate(item.settledOn)}</span>
              <span className="min-w-0 flex-1">
                <span className={cn("block font-medium tabular-nums", inactive && "text-muted-foreground line-through")}>
                  {settlementSentence(item, viewerId)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {settlementMethodLabel(item.method)}
                  {showGroup ? ` · ${item.groupName ?? "Direct"}` : ""}
                </span>
              </span>
              <SettlementStatusBadge status={item.status} />
              <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            </Link>
            {answer ? (
              <div className="px-4 pb-3">
                <SettlementActions settlement={item} viewerId={viewerId} compact />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

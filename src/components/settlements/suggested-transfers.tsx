import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { ROUTES } from "@/lib/auth/routes";
import { formatMoney, minorToDecimalString } from "@/lib/money/format";
import type { Transfer } from "@/lib/settlements/simplify";
import { cn } from "@/lib/utils";

/** The settle-up form, prefilled with one suggested transfer from the viewer's side. */
export function settleUpHref(groupId: string, transfer: Transfer, viewerId: string): string {
  const paying = transfer.fromUserId === viewerId;
  const params = new URLSearchParams({
    group: groupId,
    person: paying ? transfer.toUserId : transfer.fromUserId,
    direction: paying ? "paid" : "received",
    amount: minorToDecimalString(transfer.amount, transfer.currency),
    currency: transfer.currency,
  });
  return `${ROUTES.settleUp}?${params.toString()}`;
}

/**
 * Suggested repayments for a group. Only the payer or the receiver can record
 * a settlement, so only transfers involving the viewer get a button.
 */
export function SuggestedTransfers({
  groupId,
  transfers,
  viewerId,
  nameOf,
}: {
  groupId: string;
  transfers: readonly Transfer[];
  viewerId: string;
  nameOf: (userId: string) => string;
}) {
  const label = (userId: string) => (userId === viewerId ? "You" : nameOf(userId));
  return (
    <ul className="divide-y rounded-xl border" aria-label="Suggested repayments">
      {transfers.map((transfer) => {
        const mine = transfer.fromUserId === viewerId || transfer.toUserId === viewerId;
        const money = formatMoney(transfer.amount, transfer.currency);
        const verb = transfer.fromUserId === viewerId ? "pay" : "pays";
        const to = transfer.toUserId === viewerId ? "you" : nameOf(transfer.toUserId);
        return (
          <li
            key={`${transfer.currency}-${transfer.fromUserId}-${transfer.toUserId}`}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <p className="min-w-0 text-sm">
              <span className="font-medium">{label(transfer.fromUserId)}</span> {verb}{" "}
              <span className="font-medium">{to}</span> <span className="tabular-nums">{money}</span>
            </p>
            {mine ? (
              <Link
                href={settleUpHref(groupId, transfer, viewerId)}
                className={cn(buttonVariants({ variant: "outline" }), "h-11 md:h-8")}
              >
                {transfer.fromUserId === viewerId ? "Record payment" : "Record as received"}
              </Link>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

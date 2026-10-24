import { HandCoins, ReceiptText } from "lucide-react";
import Link from "next/link";

import { ROW_LINK_CLASS } from "@/components/shared/row-link";
import { ROUTES } from "@/lib/auth/routes";
import { formatTimestamp } from "@/lib/expenses/dates";
import { cn } from "@/lib/utils";
import type { ActivityFeedItem } from "@/server/activity";

/** Expense and settlement history, each row linking to what it is about. */
export function ActivityList({
  items,
  label,
  timeZone,
}: {
  items: readonly ActivityFeedItem[];
  label: string;
  /** The viewer's profile time zone (times are never shown in the server's). */
  timeZone: string;
}) {
  return (
    <ul className="divide-y rounded-xl border" aria-label={label}>
      {items.map((item) => {
        const Icon = item.kind === "expense" ? ReceiptText : HandCoins;
        const href = `${item.kind === "expense" ? ROUTES.expenses : ROUTES.settlements}/${item.entityId}`;
        return (
          <li key={item.id}>
            <Link
              href={href}
              className={cn("flex min-h-16 items-start gap-3 px-4 py-3", ROW_LINK_CLASS)}
            >
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                <Icon aria-hidden className="size-4 text-muted-foreground" />
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-sm break-words">{item.title}</span>
                <span className="text-xs text-muted-foreground">
                  {formatTimestamp(item.at, timeZone)} · {item.groupName ?? "Direct"}
                </span>
                {item.effect ? (
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      item.tone === "positive" && "text-primary",
                      item.tone === "negative" && "text-destructive",
                      item.tone === "neutral" && "text-muted-foreground",
                    )}
                  >
                    {item.effect}
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

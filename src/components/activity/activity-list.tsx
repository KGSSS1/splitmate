import { HandCoins, ReceiptText } from "lucide-react";
import Link from "next/link";

import { ROUTES } from "@/lib/auth/routes";
import { cn } from "@/lib/utils";
import type { ActivityFeedItem } from "@/server/activity";

const timeFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

/** Expense and settlement history, each row linking to what it is about. */
export function ActivityList({ items, label }: { items: readonly ActivityFeedItem[]; label: string }) {
  return (
    <ul className="divide-y rounded-xl border" aria-label={label}>
      {items.map((item) => {
        const Icon = item.kind === "expense" ? ReceiptText : HandCoins;
        const href = `${item.kind === "expense" ? ROUTES.expenses : ROUTES.settlements}/${item.entityId}`;
        return (
          <li key={item.id}>
            <Link
              href={href}
              className="flex min-h-16 items-start gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
            >
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                <Icon aria-hidden className="size-4 text-muted-foreground" />
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-sm break-words">{item.title}</span>
                <span className="text-xs text-muted-foreground">
                  {timeFormat.format(new Date(item.at))} · {item.groupName ?? "Direct"}
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

"use client";

import { Bell, Check } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { NOTIFICATIONS_CHANGED_EVENT } from "@/components/notifications/unread-count";
import { ROW_LINK_CLASS } from "@/components/shared/row-link";
import { Button } from "@/components/ui/button";
import { formatTimestamp } from "@/lib/expenses/dates";
import type { NotificationItem } from "@/lib/notifications/describe";
import { cn } from "@/lib/utils";
import { markNotificationsRead } from "@/server/actions/notifications";

function announceChange() {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}

/**
 * The viewer's notifications. Unread ones carry a dot and the word "Unread"
 * (never colour alone). Following one, or its "Mark read" button, marks it read;
 * the row updates at once and the badges refresh once the server confirms.
 */
export function NotificationList({ items, timeZone }: { items: readonly NotificationItem[]; timeZone: string }) {
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function markRead(id: string) {
    setError(null);
    setReadIds((current) => new Set(current).add(id));
    startTransition(async () => {
      try {
        const result = await markNotificationsRead({ ids: [id] });
        if (result.ok) {
          announceChange();
          return;
        }
        startTransition(() => {
          setError(result.error);
          setReadIds((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
          });
        });
      } catch {
        startTransition(() => setError("Couldn't reach the server. Check your connection and try again."));
      }
    });
  }

  return (
    <div className="grid gap-3">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ul className="divide-y rounded-xl border" aria-label="Notifications">
        {items.map((item) => {
          const read = item.read || readIds.has(item.id);
          return (
            <li key={item.id} className={cn("flex items-stretch", !read && "bg-primary/5")} data-read={read}>
              <Link
                href={item.href}
                onClick={() => {
                  if (!read) markRead(item.id);
                }}
                className={cn("flex min-h-16 min-w-0 flex-1 items-start gap-3 px-4 py-3", ROW_LINK_CLASS)}
              >
                <span className="relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Bell aria-hidden className="size-4 text-muted-foreground" />
                  {read ? null : (
                    <span aria-hidden className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-primary ring-2 ring-background" />
                  )}
                </span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className={cn("text-sm break-words", !read && "font-semibold")}>
                    {read ? null : <span className="sr-only">Unread: </span>}
                    {item.title}
                  </span>
                  {item.detail ? <span className="text-xs text-muted-foreground">{item.detail}</span> : null}
                  <span className="text-xs text-muted-foreground">
                    {formatTimestamp(item.at, timeZone)}
                    {read ? null : (
                      <span className="ml-2 font-medium text-primary-emphasis" aria-hidden>
                        Unread
                      </span>
                    )}
                  </span>
                </span>
              </Link>
              {read ? null : (
                <div className="flex shrink-0 items-center pr-2">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 min-w-11 px-3 md:h-8 md:min-w-0"
                    onClick={() => markRead(item.id)}
                    aria-label={`Mark read: ${item.title}`}
                  >
                    <Check aria-hidden />
                    <span className="hidden sm:inline">Mark read</span>
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

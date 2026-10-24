"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { ROUTES } from "@/lib/auth/routes";
import { cn } from "@/lib/utils";

/** Fired after the viewer marks notifications read, so every badge refreshes at once. */
export const NOTIFICATIONS_CHANGED_EVENT = "splitmate:notifications-changed";

const COUNT_URL = `${ROUTES.notifications}/unread-count`;

let inFlight: Promise<number | null> | null = null;

/** One request at a time, shared by every badge on the page (sidebar, header, menu). */
function fetchUnread(): Promise<number | null> {
  inFlight ??= requestUnread().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function requestUnread(): Promise<number | null> {
  // "manual": a signed-out request is redirected to the login page; don't follow it.
  const response = await fetch(COUNT_URL, { cache: "no-store", redirect: "manual" });
  if (!response.ok) return null;
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("unread" in body)) return null;
  const { unread } = body;
  return typeof unread === "number" && Number.isSafeInteger(unread) && unread >= 0 ? unread : null;
}

/**
 * The viewer's unread count, refreshed on every navigation, when the tab comes
 * back into view, and when notifications are marked read. Null until known (a
 * failed request keeps the last count rather than showing an error).
 */
function useUnreadCount(): number | null {
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      fetchUnread()
        .then((next) => {
          if (active && next !== null) setCount(next);
        })
        .catch(() => {
          // Offline or the server is unreachable: keep the last count.
        });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    load();
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, load);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, load);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pathname]);

  return count;
}

function display(count: number): string {
  return count > 99 ? "99+" : String(count);
}

function UnreadPill({ className }: { className?: string }) {
  const count = useUnreadCount();
  if (!count) return null;
  return (
    <span
      data-unread-badge
      className={cn(
        "inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[0.7rem] leading-5 font-semibold text-primary-foreground tabular-nums",
        className,
      )}
    >
      {display(count)}
      <span className="sr-only"> unread</span>
    </span>
  );
}

/** The badge beside "Notifications" in the sidebar and the phone menu. */
export function UnreadBadge({ className }: { className?: string }) {
  return (
    <Suspense fallback={null}>
      <UnreadPill className={className} />
    </Suspense>
  );
}

function BellLinkInner() {
  const count = useUnreadCount();
  const label = count ? `Notifications, ${display(count)} unread` : "Notifications";
  return (
    <Link
      href={ROUTES.notifications}
      aria-label={label}
      className="relative inline-flex size-11 items-center justify-center rounded-lg text-foreground hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <Bell aria-hidden className="size-5" />
      {count ? (
        <span
          aria-hidden
          data-unread-badge
          className="absolute top-1 right-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[0.65rem] leading-5 font-semibold text-primary-foreground tabular-nums"
        >
          {display(count)}
        </span>
      ) : null}
    </Link>
  );
}

/** Bell icon with the unread count, for the phone header. */
export function NotificationsBellLink() {
  return (
    <Suspense
      fallback={
        <Link
          href={ROUTES.notifications}
          aria-label="Notifications"
          className="inline-flex size-11 items-center justify-center rounded-lg"
        >
          <Bell aria-hidden className="size-5" />
        </Link>
      }
    >
      <BellLinkInner />
    </Suspense>
  );
}

import { Bell, Settings } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MarkAllReadButton } from "@/components/notifications/mark-all-read-button";
import { NotificationList } from "@/components/notifications/notification-list";
import { EmptyState } from "@/components/shared/empty-state";
import { Pager } from "@/components/shared/pager";
import { buttonVariants } from "@/components/ui/button";
import { ROUTES } from "@/lib/auth/routes";
import { cn } from "@/lib/utils";
import { settlementPageSchema } from "@/lib/validation/settlements";
import { requireOnboardedProfile } from "@/server/auth";
import { listNotifications } from "@/server/notifications";

export const metadata: Metadata = { title: "Notifications" };

/** In-app notifications (SPEC §15), newest first, with unread ones marked. */
export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const [query, profile] = await Promise.all([searchParams, requireOnboardedProfile()]);
  const page = settlementPageSchema.parse(query.page);
  const notifications = await listNotifications(page);
  if (page > notifications.pageCount) notFound();

  return (
    <div className="grid max-w-3xl gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Notifications</h1>
          <p className="text-muted-foreground" role="status">
            {notifications.unread === 0
              ? "You're all caught up."
              : `${notifications.unread} unread ${notifications.unread === 1 ? "notification" : "notifications"}.`}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {notifications.unread > 0 ? <MarkAllReadButton /> : null}
          <Link
            href={`${ROUTES.settings}#notifications`}
            className={cn(buttonVariants({ variant: "ghost" }), "h-11 md:h-8")}
          >
            <Settings aria-hidden />
            Choose what you get
          </Link>
        </div>
      </header>
      {notifications.items.length === 0 ? (
        <EmptyState icon={Bell} title="No notifications yet">
          <p>You&apos;ll hear here when friends add expenses with you, record repayments or invite you to groups.</p>
        </EmptyState>
      ) : (
        <NotificationList items={notifications.items} timeZone={profile.timezone} />
      )}
      <Pager base={ROUTES.notifications} page={page} pageCount={notifications.pageCount} label="Notification pages" />
    </div>
  );
}

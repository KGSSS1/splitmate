import { Activity } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActivityList } from "@/components/activity/activity-list";
import { EmptyState } from "@/components/shared/empty-state";
import { Pager } from "@/components/shared/pager";
import { ROUTES } from "@/lib/auth/routes";
import { settlementPageSchema } from "@/lib/validation/settlements";
import { requireOnboardedProfile } from "@/server/auth";
import { listActivity } from "@/server/activity";

export const metadata: Metadata = { title: "Activity" };

/** Every expense and settlement change the viewer can see, newest first. */
export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  const [query] = await Promise.all([searchParams, requireOnboardedProfile()]);
  const page = settlementPageSchema.parse(query.page);
  const activity = await listActivity({ page });
  if (page > activity.pageCount) notFound();

  return (
    <div className="grid max-w-3xl gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Activity</h1>
        <p className="text-muted-foreground">
          Expenses added, edited or cancelled, and repayments, in your groups and with friends.
        </p>
      </header>
      {activity.items.length === 0 ? (
        <EmptyState icon={Activity} title="Nothing here yet">
          <p>When you or your friends add expenses or record repayments, they show up here.</p>
        </EmptyState>
      ) : (
        <ActivityList items={activity.items} label="Activity" />
      )}
      <Pager base={ROUTES.activity} page={page} pageCount={activity.pageCount} label="Activity pages" />
    </div>
  );
}

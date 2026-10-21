import { ReceiptText } from "lucide-react";
import type { Metadata } from "next";

import { BalanceSummary } from "@/components/dashboard/balance-summary";
import { EmptyState } from "@/components/shared/empty-state";
import { requireOnboardedProfile } from "@/server/auth";
import { getBalanceSummary } from "@/server/balances";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const [profile, summaries] = await Promise.all([requireOnboardedProfile(), getBalanceSummary()]);

  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Hi, {profile.display_name}</h1>
        <p className="text-muted-foreground">Here&apos;s where you stand with everyone.</p>
      </header>

      {summaries.length === 0 ? (
        <EmptyState icon={ReceiptText} title="No balances yet">
          <p>
            When you split an expense with a friend or a group, what you owe and what you&apos;re owed
            shows up here.
          </p>
        </EmptyState>
      ) : (
        <BalanceSummary summaries={summaries} />
      )}
    </div>
  );
}

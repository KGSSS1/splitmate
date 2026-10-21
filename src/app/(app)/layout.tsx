import { Suspense } from "react";

import { AccountSummary, AccountSummarySkeleton } from "@/components/layout/account-summary";
import { AddExpenseButton, BottomNav, SidebarNav } from "@/components/layout/app-nav";
import { BrandMark } from "@/components/layout/brand-mark";
import { MobileMenu } from "@/components/layout/mobile-menu";
import { PageSkeleton } from "@/components/layout/page-skeleton";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { ThemePicker } from "@/components/theme/theme-picker";
import { ROUTES } from "@/lib/auth/routes";
import { requireOnboardedProfile } from "@/server/auth";

/**
 * Signed-in app shell (SPEC §9): sidebar on desktop; header + bottom bar with
 * Add Expense on phones. The static frame prerenders; anything that reads the
 * session streams in behind a Suspense boundary.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-3 focus:ring-ring/50"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 border-r bg-sidebar px-4 py-6 text-sidebar-foreground md:flex">
        <BrandMark href={ROUTES.dashboard} className="px-2" />
        <AddExpenseButton variant="sidebar" />
        <SidebarNav />
        <div className="grid gap-4 border-t pt-4">
          <Suspense fallback={<AccountSummarySkeleton />}>
            <AccountSummary />
          </Suspense>
          <ThemePicker />
          <SignOutButton className="w-full" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
          <BrandMark href={ROUTES.dashboard} className="h-14" />
          <MobileMenu />
        </header>

        <main
          id="main"
          className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-8 md:pt-10 md:pb-10"
        >
          <Suspense fallback={<PageSkeleton />}>
            <OnboardingGate>{children}</OnboardingGate>
          </Suspense>
        </main>
      </div>

      <BottomNav />
    </div>
  );
}

/** Sends users who have not finished onboarding there before any app page renders. */
async function OnboardingGate({ children }: { children: React.ReactNode }) {
  await requireOnboardedProfile();
  return children;
}

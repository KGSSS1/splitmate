import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthCard } from "@/components/auth/auth-card";
import { AuthFormSkeleton } from "@/components/auth/auth-form-skeleton";
import { BrandMark } from "@/components/layout/brand-mark";
import { OnboardingForm } from "@/components/profile/onboarding-form";
import { brand } from "@/config/brand";
import { ROUTES, safeNextPath } from "@/lib/auth/routes";
import { getProfile } from "@/server/auth";

export const metadata: Metadata = { title: "Welcome" };

export default function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  return (
    <main className="flex flex-1 flex-col items-center px-4 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <BrandMark href={ROUTES.dashboard} />
        <AuthCard title={`Welcome to ${brand.name}`} description="Two quick things before you start.">
          <Suspense fallback={<AuthFormSkeleton />}>
            <Onboarding searchParams={searchParams} />
          </Suspense>
        </AuthCard>
      </div>
    </main>
  );
}

/** `?next=` is where to go afterwards, e.g. the invitation the user signed up from. */
async function Onboarding({ searchParams }: Pick<PageProps<"/onboarding">, "searchParams">) {
  const [profile, { next }] = await Promise.all([getProfile(), searchParams]);
  const nextPath = typeof next === "string" ? safeNextPath(next) : ROUTES.dashboard;
  if (profile.onboarded_at) redirect(nextPath);

  return (
    <OnboardingForm
      defaultValues={{ displayName: profile.display_name, defaultCurrency: profile.default_currency }}
      next={nextPath === ROUTES.dashboard ? undefined : nextPath}
    />
  );
}

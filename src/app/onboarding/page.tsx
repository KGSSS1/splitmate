import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthCard } from "@/components/auth/auth-card";
import { AuthFormSkeleton } from "@/components/auth/auth-form-skeleton";
import { BrandMark } from "@/components/layout/brand-mark";
import { OnboardingForm } from "@/components/profile/onboarding-form";
import { brand } from "@/config/brand";
import { ROUTES } from "@/lib/auth/routes";
import { getProfile } from "@/server/auth";

export const metadata: Metadata = { title: "Welcome" };

export default function OnboardingPage() {
  return (
    <main className="flex flex-1 flex-col items-center px-4 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <BrandMark href={ROUTES.dashboard} />
        <AuthCard title={`Welcome to ${brand.name}`} description="Two quick things before you start.">
          <Suspense fallback={<AuthFormSkeleton />}>
            <Onboarding />
          </Suspense>
        </AuthCard>
      </div>
    </main>
  );
}

async function Onboarding() {
  const profile = await getProfile();
  if (profile.onboarded_at) redirect(ROUTES.dashboard);

  return (
    <OnboardingForm
      defaultValues={{ displayName: profile.display_name, defaultCurrency: profile.default_currency }}
    />
  );
}

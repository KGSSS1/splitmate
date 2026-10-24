import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { FormStatus } from "@/components/forms/form-status";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { NotificationPreferencesForm } from "@/components/notifications/preferences-form";
import { ProfileForm } from "@/components/profile/profile-form";
import { ThemePicker } from "@/components/theme/theme-picker";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/lib/auth/routes";
import { timeZoneOptions } from "@/lib/profile/options";
import { cn } from "@/lib/utils";
import { requireOnboardedProfile } from "@/server/auth";
import { getNotificationPreferences } from "@/server/notifications";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const [profile, notificationPreferences] = await Promise.all([
    requireOnboardedProfile(),
    getNotificationPreferences(),
  ]);

  return (
    <div className="grid max-w-2xl gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Settings</h1>
        <p className="text-muted-foreground">Your profile, notifications, appearance and account.</p>
      </header>

      <Suspense fallback={null}>
        <UpdatedNotice searchParams={searchParams} />
      </Suspense>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Profile</h2>
          </CardTitle>
          <CardDescription>Friends and group members see your name.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            defaultValues={{
              displayName: profile.display_name,
              defaultCurrency: profile.default_currency,
              timeZone: profile.timezone,
            }}
            timeZones={timeZoneOptions(profile.timezone)}
          />
        </CardContent>
      </Card>

      <Card id="notifications" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>
            <h2>Notifications</h2>
          </CardTitle>
          <CardDescription>
            What shows up on your Notifications page. Repayments waiting for you to confirm always show on your dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationPreferencesForm defaultValues={notificationPreferences} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Appearance</h2>
          </CardTitle>
          <CardDescription>Saved on this device.</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemePicker className="max-w-sm" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Account</h2>
          </CardTitle>
          {profile.email ? <CardDescription>Signed in as {profile.email}</CardDescription> : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Link
            href={ROUTES.updatePassword}
            className={cn(buttonVariants({ variant: "outline" }), "h-11 md:h-9")}
          >
            <KeyRound aria-hidden />
            Change password
          </Link>
          <SignOutButton className="w-full sm:w-auto" />
        </CardContent>
      </Card>
    </div>
  );
}

async function UpdatedNotice({ searchParams }: Pick<PageProps<"/settings">, "searchParams">) {
  const { updated } = await searchParams;
  return updated === "password" ? <FormStatus success="Your password has been updated." /> : null;
}

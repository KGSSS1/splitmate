import { Download, KeyRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { FormStatus } from "@/components/forms/form-status";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { NotificationPreferencesForm } from "@/components/notifications/preferences-form";
import { DeleteAccountForm } from "@/components/profile/delete-account-form";
import { ProfileForm } from "@/components/profile/profile-form";
import { ThemePicker } from "@/components/theme/theme-picker";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/lib/auth/routes";
import { timeZoneOptions } from "@/lib/profile/options";
import { EXPORT_DATASETS } from "@/server/data-export";
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
        <p className="text-muted-foreground">Your profile, notifications, appearance, data and account.</p>
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

      <Card id="your-data" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>
            <h2>Your data</h2>
          </CardTitle>
          <CardDescription>
            Everything your account can see: your profile, friends, groups, expenses, repayments, history and
            notifications. Amounts are in the currency&apos;s smallest unit (paise, cents).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <a
            href={`${ROUTES.dataExport}?format=json`}
            download
            className={cn(buttonVariants(), "h-11 justify-self-start md:h-9")}
          >
            <Download aria-hidden />
            Download everything (JSON)
          </a>
          <details className="text-sm">
            <summary className="cursor-pointer py-3 font-medium md:py-1">Download one table as CSV</summary>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2" aria-label="CSV files">
              {Object.entries(EXPORT_DATASETS).map(([dataset, { label }]) => (
                <li key={dataset}>
                  <a
                    href={`${ROUTES.dataExport}?format=csv&dataset=${dataset}`}
                    download
                    className="inline-flex min-h-11 items-center gap-2 text-primary-emphasis underline-offset-4 hover:underline md:min-h-8"
                  >
                    <Download aria-hidden className="size-4" />
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        </CardContent>
      </Card>

      <Card id="delete-account" className="scroll-mt-20 border-destructive/40">
        <CardHeader>
          <CardTitle>
            <h2>Delete account</h2>
          </CardTitle>
          <CardDescription>
            Settle up first: you can delete your account once you owe nothing and nobody owes you. Deleting signs you
            out everywhere, leaves your groups and removes your name, email and friend list. Shared expenses and
            repayments stay in others&apos; history as &ldquo;Deleted user&rdquo;. This can&apos;t be undone, so
            download your data first if you want a copy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteAccountForm />
        </CardContent>
      </Card>
    </div>
  );
}

async function UpdatedNotice({ searchParams }: Pick<PageProps<"/settings">, "searchParams">) {
  const { updated } = await searchParams;
  return updated === "password" ? <FormStatus success="Your password has been updated." /> : null;
}

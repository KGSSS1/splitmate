import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { GroupForm } from "@/components/groups/group-form";
import { Card, CardContent } from "@/components/ui/card";
import { ROUTES } from "@/lib/auth/routes";
import { requireOnboardedProfile } from "@/server/auth";

export const metadata: Metadata = { title: "New group" };

export default async function NewGroupPage() {
  const profile = await requireOnboardedProfile();

  return (
    <div className="grid max-w-2xl gap-6">
      <Link
        href={ROUTES.groups}
        className="inline-flex min-h-11 items-center gap-1 justify-self-start text-sm text-muted-foreground hover:text-foreground md:min-h-0"
      >
        <ArrowLeft aria-hidden className="size-4" />
        All groups
      </Link>
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">New group</h1>
        <p className="text-muted-foreground">You&apos;ll be the group&apos;s admin. Invite people once it&apos;s created.</p>
      </header>
      <Card>
        <CardContent>
          <GroupForm
            defaultValues={{
              name: "",
              description: "",
              groupType: "trip",
              defaultCurrency: profile.default_currency,
              simplifyDebts: true,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { GroupForm } from "@/components/groups/group-form";
import { GroupHeader } from "@/components/groups/group-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/lib/auth/routes";
import { GROUP_TYPE_LABELS } from "@/lib/groups/options";
import { uuidSchema } from "@/lib/validation/groups";
import { requireOnboardedProfile } from "@/server/auth";
import { getGroup } from "@/server/groups";

export const metadata: Metadata = { title: "Group settings" };

export default async function GroupSettingsPage({ params }: PageProps<"/groups/[groupId]/settings">) {
  const [{ groupId }] = await Promise.all([params, requireOnboardedProfile()]);
  if (!uuidSchema.safeParse(groupId).success) notFound();
  const view = await getGroup(groupId);
  if (!view) notFound();
  if (view.access === "former") redirect(`${ROUTES.groups}/${groupId}`);

  const { group, isAdmin } = view;

  return (
    <div className="grid max-w-3xl gap-6">
      <GroupHeader group={group} />
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Group settings</h2>
          </CardTitle>
          <CardDescription>
            {isAdmin ? "Only admins can change these." : "Only admins can change these. Ask an admin."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isAdmin ? (
            <GroupForm
              groupId={group.id}
              defaultValues={{
                name: group.name,
                description: group.description ?? "",
                groupType: group.groupType,
                defaultCurrency: group.defaultCurrency,
                simplifyDebts: group.simplifyDebts,
              }}
            />
          ) : (
            <dl className="grid gap-3 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6">
              <dt className="text-muted-foreground">Name</dt>
              <dd>{group.name}</dd>
              <dt className="text-muted-foreground">Type</dt>
              <dd>{GROUP_TYPE_LABELS[group.groupType]}</dd>
              <dt className="text-muted-foreground">Default currency</dt>
              <dd>{group.defaultCurrency}</dd>
              <dt className="text-muted-foreground">Simplify debts</dt>
              <dd>{group.simplifyDebts ? "On" : "Off"}</dd>
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

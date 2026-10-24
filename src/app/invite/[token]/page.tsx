import { UserPlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthCard } from "@/components/auth/auth-card";
import { AuthFormSkeleton } from "@/components/auth/auth-form-skeleton";
import { FormStatus } from "@/components/forms/form-status";
import { GroupTypeIcon } from "@/components/groups/group-type-icon";
import { BrandMark } from "@/components/layout/brand-mark";
import { ActionButton } from "@/components/shared/action-button";
import { buttonVariants } from "@/components/ui/button";
import { brand } from "@/config/brand";
import { ROUTES } from "@/lib/auth/routes";
import { GROUP_TYPE_LABELS } from "@/lib/groups/options";
import { buildInvitePath, INVITE_STATUS_MESSAGES } from "@/lib/groups/invite-link";
import { cn } from "@/lib/utils";
import { inviteTokenSchema, uuidSchema } from "@/lib/validation/groups";
import { acceptInvitation } from "@/server/actions/invitations";
import { getCurrentUser, getProfile } from "@/server/auth";
import { getInvitationPreview } from "@/server/invitations";

export const metadata: Metadata = {
  title: "Invitation",
  // The token is in the URL: never send it to another site or let it be indexed.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

/**
 * Invitation acceptance (SPEC §9 screen 14). Public, so a signed-out visitor
 * is asked to sign up or log in and comes back here afterwards.
 */
export default function InvitePage({ params, searchParams }: PageProps<"/invite/[token]">) {
  return (
    <main className="flex flex-1 flex-col items-center px-4 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <BrandMark href={ROUTES.dashboard} />
        <Suspense fallback={<AuthFormSkeleton />}>
          <Invitation params={params} searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function Invitation({ params, searchParams }: PageProps<"/invite/[token]">) {
  const [{ token }, { group }, user] = await Promise.all([params, searchParams, getCurrentUser()]);
  const groupParam = typeof group === "string" ? group : undefined;
  const tokenValid = inviteTokenSchema.safeParse(token).success;
  // A group ID that is not even a UUID cannot match the token's group.
  const groupId = groupParam && uuidSchema.safeParse(groupParam).success ? groupParam : undefined;
  // Where to come back to after signing up, logging in or onboarding.
  const here = tokenValid ? buildInvitePath(token, groupParam) : ROUTES.dashboard;

  if (!user) {
    const next = encodeURIComponent(here);
    return (
      <AuthCard
        title="You're invited"
        description={`Someone invited you to a group on ${brand.name}. Create an account or log in to see the invitation and join.`}
      >
        <div className="grid gap-3">
          <Link href={`${ROUTES.signup}?next=${next}`} className={cn(buttonVariants({ size: "lg" }), "h-11 w-full md:h-9")}>
            Sign up to join
          </Link>
          <Link
            href={`${ROUTES.login}?next=${next}`}
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 w-full md:h-9")}
          >
            I already have an account
          </Link>
        </div>
      </AuthCard>
    );
  }

  const profile = await getProfile();
  if (!profile.onboarded_at) redirect(`${ROUTES.onboarding}?next=${encodeURIComponent(here)}`);

  const preview =
    !tokenValid || (groupParam !== undefined && groupId === undefined)
      ? { status: tokenValid ? ("wrong_group" as const) : ("not_found" as const) }
      : await getInvitationPreview(token, groupId);

  if (preview.status !== "valid" && preview.status !== "member") {
    return (
      <AuthCard title="Invitation can't be used">
        <div className="grid gap-4">
          <FormStatus error={INVITE_STATUS_MESSAGES[preview.status]} />
          <Link href={ROUTES.groups} className={cn(buttonVariants({ variant: "outline" }), "h-11 md:h-9")}>
            Go to your groups
          </Link>
        </div>
      </AuthCard>
    );
  }

  const groupHref = `${ROUTES.groups}/${preview.groupId}`;
  return (
    <AuthCard title={preview.status === "member" ? "You're already in this group" : "Join this group?"}>
      <div className="grid gap-5">
        <div className="flex items-center gap-3">
          <GroupTypeIcon type={preview.groupType} className="size-12" />
          <div className="min-w-0">
            <p className="text-lg font-semibold break-words">{preview.groupName}</p>
            <p className="text-sm text-muted-foreground">
              {GROUP_TYPE_LABELS[preview.groupType]} · {preview.memberCount}{" "}
              {preview.memberCount === 1 ? "member" : "members"}
            </p>
          </div>
        </div>
        {preview.status === "member" ? (
          <Link href={groupHref} className={cn(buttonVariants({ size: "lg" }), "h-11 w-full md:h-9")}>
            Open the group
          </Link>
        ) : (
          <>
            <p className="text-sm">
              <strong>{preview.inviterName}</strong> invited you. Joining makes you friends with everyone in the group,
              so you can split expenses together.
            </p>
            <ActionButton
              variant="default"
              className="w-full"
              action={acceptInvitation.bind(null, { token, groupId })}
            >
              <UserPlus aria-hidden />
              Join group
            </ActionButton>
          </>
        )}
      </div>
    </AuthCard>
  );
}

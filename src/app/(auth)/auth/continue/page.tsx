import { MailCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/lib/auth/routes";
import { emailLinkSchema } from "@/lib/validation/auth";
import { confirmEmailLink } from "@/server/actions/auth";

export const metadata: Metadata = {
  title: "Continue",
  // The URL holds a one-time token: keep it out of search engines and referrers.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const COPY = {
  email: { title: "Confirm your email", body: "Press Continue to confirm your email address and sign in.", action: "Continue" },
  signup: { title: "Confirm your email", body: "Press Continue to confirm your email address and sign in.", action: "Continue" },
  recovery: { title: "Reset your password", body: "Press Continue to choose a new password.", action: "Continue" },
} as const;

/**
 * Where token-hash email links land (via /auth/confirm). Nothing happens until
 * the button is pressed, so link scanners can't use the token up and a link
 * sent by someone else can't silently sign you into their account.
 */
export default function ContinuePage({ searchParams }: PageProps<"/auth/continue">) {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <ContinueCard searchParams={searchParams} />
    </Suspense>
  );
}

async function ContinueCard({ searchParams }: Pick<PageProps<"/auth/continue">, "searchParams">) {
  const params = await searchParams;
  const link = emailLinkSchema.safeParse({ tokenHash: params.token_hash, type: params.type });
  if (!link.success) {
    return (
      <AuthCard title="This link doesn't work">
        <p className="text-center text-sm">
          It may be incomplete. Open the newest email from SplitMate, or{" "}
          <Link href={ROUTES.login} className="font-medium text-primary-emphasis underline-offset-4 hover:underline">
            go to log in
          </Link>
          .
        </p>
      </AuthCard>
    );
  }
  const copy = COPY[link.data.type];
  return (
    <AuthCard title={copy.title}>
      <form action={confirmEmailLink} className="flex flex-col items-center gap-4 text-center">
        <MailCheck aria-hidden className="size-10 text-primary" />
        <p>{copy.body}</p>
        <input type="hidden" name="token_hash" value={link.data.tokenHash} />
        <input type="hidden" name="type" value={link.data.type} />
        <Button type="submit" size="lg" className="h-11 w-full md:h-9">
          {copy.action}
        </Button>
        <p className="text-xs text-muted-foreground">Didn&apos;t ask for this? Close this page; nothing changes.</p>
      </form>
    </AuthCard>
  );
}

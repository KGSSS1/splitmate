import { MailCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AuthCard } from "@/components/auth/auth-card";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Check your email" };

const MESSAGES = {
  signup:
    "We've sent you a link to confirm your email address. Open it on this or any device to finish signing up.",
  reset:
    "If an account exists for that address, we've sent a link to reset your password. It expires in an hour.",
} as const;

export default function CheckEmailPage({ searchParams }: PageProps<"/check-email">) {
  return (
    <AuthCard
      title="Check your email"
      footer={
        <Link href={ROUTES.login} className="font-medium text-primary underline-offset-4 hover:underline">
          Back to log in
        </Link>
      }
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <MailCheck aria-hidden className="size-10 text-primary" />
        <Suspense fallback={<Skeleton className="h-10 w-full" />}>
          <Message searchParams={searchParams} />
        </Suspense>
        <p className="text-sm text-muted-foreground">Can&apos;t find it? Check your spam folder.</p>
      </div>
    </AuthCard>
  );
}

async function Message({ searchParams }: Pick<PageProps<"/check-email">, "searchParams">) {
  const { for: reason } = await searchParams;
  return <p>{reason === "reset" ? MESSAGES.reset : MESSAGES.signup}</p>;
}

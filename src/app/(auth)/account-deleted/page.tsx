import { UserX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { ROUTES } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Account deleted" };

/** Where account deletion ends, signed out. */
export default function AccountDeletedPage() {
  return (
    <AuthCard
      title="Your account is deleted"
      footer={
        <Link href={ROUTES.home} className="font-medium text-primary-emphasis underline-offset-4 hover:underline">
          Back to the home page
        </Link>
      }
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <UserX aria-hidden className="size-10 text-muted-foreground" />
        <p>You&apos;ve been signed out everywhere, and your email address and name have been removed.</p>
        <p className="text-sm text-muted-foreground">
          Expenses and repayments you shared stay in your friends&apos; and groups&apos; history as &ldquo;Deleted
          user&rdquo;, so their balances remain correct. You can sign up again with the same email at any time.
        </p>
      </div>
    </AuthCard>
  );
}

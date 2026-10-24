import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthCard } from "@/components/auth/auth-card";
import { AuthFormSkeleton } from "@/components/auth/auth-form-skeleton";
import { AuthSwitchLink } from "@/components/auth/auth-switch-link";
import { SignUpForm } from "@/components/auth/signup-form";
import { ROUTES } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Sign up" };

export default function SignUpPage() {
  return (
    <AuthCard
      title="Create your account"
      description="Split bills with friends and groups, and always know who owes whom."
      footer={
        <p>
          Already have an account?{" "}
          <AuthSwitchLink href={ROUTES.login}>Log in</AuthSwitchLink>
        </p>
      }
    >
      {/* The form reads ?next= from the URL. */}
      <Suspense fallback={<AuthFormSkeleton />}>
        <SignUpForm />
      </Suspense>
    </AuthCard>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthCard } from "@/components/auth/auth-card";
import { AuthFormSkeleton } from "@/components/auth/auth-form-skeleton";
import { AuthSwitchLink } from "@/components/auth/auth-switch-link";
import { LoginForm } from "@/components/auth/login-form";
import { ROUTES } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <AuthCard
      title="Log in"
      description="Welcome back. Log in to see your balances."
      footer={
        <p>
          New here?{" "}
          <AuthSwitchLink href={ROUTES.signup}>Create an account</AuthSwitchLink>
        </p>
      }
    >
      {/* The form reads ?next= and ?error= from the URL. */}
      <Suspense fallback={<AuthFormSkeleton />}>
        <LoginForm />
      </Suspense>
    </AuthCard>
  );
}

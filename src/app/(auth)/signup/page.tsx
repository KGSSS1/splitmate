import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
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
          <Link href={ROUTES.login} className="font-medium text-primary underline-offset-4 hover:underline">
            Log in
          </Link>
        </p>
      }
    >
      <SignUpForm />
    </AuthCard>
  );
}

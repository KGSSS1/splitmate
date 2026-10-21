import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { ResetRequestForm } from "@/components/auth/reset-request-form";
import { ROUTES } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Reset password" };

export default function ResetPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      description="Enter your account's email and we'll send you a link to choose a new password."
      footer={
        <Link href={ROUTES.login} className="font-medium text-primary underline-offset-4 hover:underline">
          Back to log in
        </Link>
      }
    >
      <ResetRequestForm />
    </AuthCard>
  );
}

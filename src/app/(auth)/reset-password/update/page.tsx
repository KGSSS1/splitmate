import type { Metadata } from "next";

import { AuthCard } from "@/components/auth/auth-card";
import { UpdatePasswordForm } from "@/components/auth/update-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

// Protected by src/proxy.ts; the updatePassword action re-checks the session.
export default function UpdatePasswordPage() {
  return (
    <AuthCard title="Choose a new password" description="You'll stay logged in on this device.">
      <UpdatePasswordForm />
    </AuthCard>
  );
}

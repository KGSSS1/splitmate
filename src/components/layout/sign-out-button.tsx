"use client";

import { LoaderCircle, LogOut } from "lucide-react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { signOut } from "@/server/actions/auth";

/** Logs out of this browser. Works as a plain form post before hydration. */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action={signOut}>
      <SignOutSubmit className={className} />
    </form>
  );
}

function SignOutSubmit({ className }: { className?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending} className={cn("h-10", className)}>
      {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <LogOut aria-hidden />}
      Log out
    </Button>
  );
}

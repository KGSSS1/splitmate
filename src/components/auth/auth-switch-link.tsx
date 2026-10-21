"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type ReactNode, Suspense } from "react";

const CLASS_NAME = "font-medium text-primary underline-offset-4 hover:underline";

/**
 * Link between the login and sign-up pages that keeps `?next=`, so someone who
 * arrived from an invitation returns to it whichever way they authenticate.
 */
export function AuthSwitchLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <Link href={href} className={CLASS_NAME}>
          {children}
        </Link>
      }
    >
      <LinkWithNext href={href}>{children}</LinkWithNext>
    </Suspense>
  );
}

function LinkWithNext({ href, children }: { href: string; children: ReactNode }) {
  const next = useSearchParams().get("next");
  return (
    <Link href={next ? `${href}?next=${encodeURIComponent(next)}` : href} className={CLASS_NAME}>
      {children}
    </Link>
  );
}

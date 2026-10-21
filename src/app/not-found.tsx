import { Compass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { BrandMark } from "@/components/layout/brand-mark";
import { buttonVariants } from "@/components/ui/button";
import { ROUTES } from "@/lib/auth/routes";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center">
      <BrandMark href={ROUTES.home} />
      <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Compass aria-hidden className="size-6" />
      </span>
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="max-w-sm text-muted-foreground">
          This page doesn&apos;t exist, or you don&apos;t have access to it.
        </p>
      </div>
      {/* Signed-in visitors are sent on to the dashboard by src/proxy.ts. */}
      <Link href={ROUTES.home} className={cn(buttonVariants(), "h-11 px-5 md:h-9")}>
        Go home
      </Link>
    </main>
  );
}

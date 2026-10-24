import { Compass } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { ROUTES } from "@/lib/auth/routes";
import { cn } from "@/lib/utils";

// Renders inside the app shell, whose layout already provides <main> (review L29).
export default function AppNotFound() {
  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Compass aria-hidden className="size-6" />
      </span>
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="max-w-sm text-muted-foreground">
          This page doesn&apos;t exist, or you don&apos;t have access to it.
        </p>
      </div>
      <Link href={ROUTES.dashboard} className={cn(buttonVariants(), "h-11 px-5 md:h-9")}>
        Go to dashboard
      </Link>
    </div>
  );
}

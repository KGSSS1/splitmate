"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Error boundary UI. Shows a fixed message only: details stay in the console
 * and server logs (matched by `digest`), never on screen (SPEC §8).
 */
export function ErrorView({ error, retry, homeHref }: { error: unknown; retry: () => void; homeHref: string }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest = error instanceof Error && "digest" in error ? String(error.digest) : null;

  return (
    <section role="alert" className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert aria-hidden className="size-6" />
      </span>
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground">
        We couldn&apos;t load this page. Your data is safe; nothing was changed. Try again in a moment.
      </p>
      {digest ? <p className="text-xs text-muted-foreground">Reference: {digest}</p> : null}
      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={retry} className="h-10">
          <RotateCcw aria-hidden />
          Try again
        </Button>
        <Link href={homeHref} className={cn(buttonVariants({ variant: "outline" }), "h-10")}>
          Go home
        </Link>
      </div>
    </section>
  );
}

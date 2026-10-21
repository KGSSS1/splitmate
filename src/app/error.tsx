"use client";

import { ErrorView } from "@/components/shared/error-view";
import { ROUTES } from "@/lib/auth/routes";

export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="flex flex-1 items-center justify-center">
      <ErrorView error={error} retry={retry} homeHref={ROUTES.home} />
    </main>
  );
}

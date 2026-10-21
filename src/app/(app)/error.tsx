"use client";

import { ErrorView } from "@/components/shared/error-view";
import { ROUTES } from "@/lib/auth/routes";

// Renders inside the app shell, so navigation stays usable.
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorView error={error} retry={retry} homeHref={ROUTES.dashboard} />;
}

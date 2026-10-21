import { CircleAlert, CircleCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";

/** Form-level error or success message, announced to screen readers. */
export function FormStatus({ error, success }: { error?: string | null; success?: string | null }) {
  if (error) {
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (success) {
    return (
      <Alert role="status" className="border-primary/30 text-primary">
        <CircleCheck aria-hidden />
        <AlertDescription className="text-foreground">{success}</AlertDescription>
      </Alert>
    );
  }
  return null;
}

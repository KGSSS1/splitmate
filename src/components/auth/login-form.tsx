"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { FormStatus } from "@/components/forms/form-status";
import { SubmitButton } from "@/components/forms/submit-button";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { useActionSubmit } from "@/hooks/use-action-submit";
import { ROUTES } from "@/lib/auth/routes";
import { signInSchema } from "@/lib/validation/auth";
import { resendConfirmation, signIn } from "@/server/actions/auth";

type Values = z.input<typeof signInSchema>;

const LINK_ERROR = "That link is invalid or has expired. Log in, or request a new link.";

export function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? undefined;
  const linkError = searchParams.get("error") === "link" ? LINK_ERROR : null;

  const form = useForm<Values, unknown, z.output<typeof signInSchema>>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "", next },
  });
  const { pending, submit, error, errorCode } = useActionSubmit(signIn, form.setError);
  const { errors } = form.formState;

  return (
    <form noValidate onSubmit={form.handleSubmit((values) => submit({ ...values, next }))} className="grid gap-4">
      <FormStatus error={error ?? linkError} />
      <TextField
        label="Email"
        type="email"
        autoComplete="email"
        inputMode="email"
        error={errors.email?.message}
        {...form.register("email")}
      />
      <TextField
        label="Password"
        type="password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...form.register("password")}
      />
      <div className="-mt-1 text-right text-sm">
        <Link href={ROUTES.resetPassword} className="text-primary underline-offset-4 hover:underline">
          Forgot your password?
        </Link>
      </div>
      <SubmitButton pending={pending}>Log in</SubmitButton>
      {errorCode === "email_not_confirmed" ? (
        <ResendConfirmation email={form.getValues("email")} />
      ) : null}
    </form>
  );
}

function ResendConfirmation({ email }: { email: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="grid gap-2 text-center text-sm">
      <Button
        type="button"
        variant="outline"
        className="h-11 md:h-9"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            try {
              const result = await resendConfirmation({ email });
              setMessage(result.ok ? (result.message ?? null) : result.error);
            } catch {
              setMessage("Couldn't reach the server. Try again.");
            }
          })
        }
      >
        Resend confirmation email
      </Button>
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}

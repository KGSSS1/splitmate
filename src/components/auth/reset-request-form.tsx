"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { FormStatus } from "@/components/forms/form-status";
import { SubmitButton } from "@/components/forms/submit-button";
import { TextField } from "@/components/forms/text-field";
import { useActionSubmit } from "@/hooks/use-action-submit";
import { passwordResetRequestSchema } from "@/lib/validation/auth";
import { requestPasswordReset } from "@/server/actions/auth";

type Values = z.input<typeof passwordResetRequestSchema>;

export function ResetRequestForm() {
  const form = useForm<Values, unknown, z.output<typeof passwordResetRequestSchema>>({
    resolver: zodResolver(passwordResetRequestSchema),
    defaultValues: { email: "" },
  });
  const { pending, submit, error } = useActionSubmit(requestPasswordReset, form.setError);

  return (
    <form noValidate onSubmit={form.handleSubmit(submit)} className="grid gap-4">
      <FormStatus error={error} />
      <TextField
        label="Email"
        type="email"
        autoComplete="email"
        inputMode="email"
        error={form.formState.errors.email?.message}
        {...form.register("email")}
      />
      <SubmitButton pending={pending}>Send reset link</SubmitButton>
    </form>
  );
}

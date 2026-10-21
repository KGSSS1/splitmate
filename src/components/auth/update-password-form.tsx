"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { FormStatus } from "@/components/forms/form-status";
import { SubmitButton } from "@/components/forms/submit-button";
import { TextField } from "@/components/forms/text-field";
import { useActionSubmit } from "@/hooks/use-action-submit";
import { MIN_PASSWORD_LENGTH, updatePasswordSchema } from "@/lib/validation/auth";
import { updatePassword } from "@/server/actions/auth";

type Values = z.input<typeof updatePasswordSchema>;

export function UpdatePasswordForm() {
  const form = useForm<Values, unknown, z.output<typeof updatePasswordSchema>>({
    resolver: zodResolver(updatePasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });
  const { pending, submit, error } = useActionSubmit(updatePassword, form.setError);
  const { errors } = form.formState;

  return (
    <form noValidate onSubmit={form.handleSubmit(submit)} className="grid gap-4">
      <FormStatus error={error} />
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        error={errors.password?.message}
        {...form.register("password")}
      />
      <TextField
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
        {...form.register("confirmPassword")}
      />
      <SubmitButton pending={pending}>Update password</SubmitButton>
    </form>
  );
}

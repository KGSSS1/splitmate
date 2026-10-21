"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { FormStatus } from "@/components/forms/form-status";
import { SubmitButton } from "@/components/forms/submit-button";
import { TextField } from "@/components/forms/text-field";
import { useActionSubmit } from "@/hooks/use-action-submit";
import { MIN_PASSWORD_LENGTH, signUpSchema } from "@/lib/validation/auth";
import { signUp } from "@/server/actions/auth";

type Values = z.input<typeof signUpSchema>;

export function SignUpForm() {
  const form = useForm<Values, unknown, z.output<typeof signUpSchema>>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { email: "", password: "" },
  });
  const { pending, submit, error } = useActionSubmit(signUp, form.setError);
  const { errors } = form.formState;

  return (
    <form noValidate onSubmit={form.handleSubmit(submit)} className="grid gap-4">
      <FormStatus error={error} />
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
        autoComplete="new-password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        error={errors.password?.message}
        {...form.register("password")}
      />
      <SubmitButton pending={pending}>Create account</SubmitButton>
    </form>
  );
}

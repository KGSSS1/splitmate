"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { FormStatus } from "@/components/forms/form-status";
import { NativeSelect } from "@/components/forms/native-select";
import { SubmitButton } from "@/components/forms/submit-button";
import { TextField } from "@/components/forms/text-field";
import { useActionSubmit } from "@/hooks/use-action-submit";
import { CURRENCY_OPTIONS, detectTimeZone } from "@/lib/profile/options";
import { onboardingSchema } from "@/lib/validation/profile";
import { completeOnboarding } from "@/server/actions/profile";

// The time zone is detected from the browser at submit time, not asked for.
const formSchema = onboardingSchema.omit({ timeZone: true });
type Values = z.input<typeof formSchema>;

export function OnboardingForm({ defaultValues, next }: { defaultValues: Values; next?: string }) {
  const form = useForm<Values, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues,
  });
  const { pending, submit, error } = useActionSubmit(completeOnboarding, form.setError);
  const { errors } = form.formState;

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => submit({ ...values, timeZone: detectTimeZone(), next }))}
      className="grid gap-4"
    >
      <FormStatus error={error} />
      <TextField
        label="Your name"
        autoComplete="name"
        hint="Friends and group members see this name."
        defaultValue={defaultValues.displayName}
        error={errors.displayName?.message}
        {...form.register("displayName")}
      />
      <NativeSelect
        label="Default currency"
        hint="Used for new expenses. You can pick another currency on any expense."
        options={CURRENCY_OPTIONS}
        defaultValue={defaultValues.defaultCurrency}
        error={errors.defaultCurrency?.message}
        {...form.register("defaultCurrency")}
      />
      <SubmitButton pending={pending}>Continue</SubmitButton>
    </form>
  );
}

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { FormStatus } from "@/components/forms/form-status";
import { NativeSelect } from "@/components/forms/native-select";
import { SubmitButton } from "@/components/forms/submit-button";
import { TextField } from "@/components/forms/text-field";
import { useActionSubmit } from "@/hooks/use-action-submit";
import { CURRENCY_OPTIONS } from "@/lib/profile/options";
import { profileSettingsSchema } from "@/lib/validation/profile";
import { updateProfile } from "@/server/actions/profile";

type Values = z.input<typeof profileSettingsSchema>;

export function ProfileForm({
  defaultValues,
  timeZones,
}: {
  defaultValues: Values;
  timeZones: readonly { value: string; label: string }[];
}) {
  const form = useForm<Values, unknown, z.output<typeof profileSettingsSchema>>({
    resolver: zodResolver(profileSettingsSchema),
    defaultValues,
  });
  const { pending, submit, error, success } = useActionSubmit(updateProfile, form.setError);
  const { errors } = form.formState;

  return (
    <form noValidate onSubmit={form.handleSubmit(submit)} className="grid gap-4">
      <FormStatus error={error} success={success} />
      {/* defaultValue puts the saved values in the server HTML, before hydration. */}
      <TextField
        label="Name"
        autoComplete="name"
        defaultValue={defaultValues.displayName}
        error={errors.displayName?.message}
        {...form.register("displayName")}
      />
      <NativeSelect
        label="Default currency"
        options={CURRENCY_OPTIONS}
        defaultValue={defaultValues.defaultCurrency}
        error={errors.defaultCurrency?.message}
        {...form.register("defaultCurrency")}
      />
      <NativeSelect
        label="Time zone"
        hint="Used for dates and recurring expenses."
        options={timeZones}
        defaultValue={defaultValues.timeZone}
        error={errors.timeZone?.message}
        {...form.register("timeZone")}
      />
      <SubmitButton pending={pending} className="md:w-auto md:justify-self-start">
        Save changes
      </SubmitButton>
    </form>
  );
}

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { FormStatus } from "@/components/forms/form-status";
import { NativeSelect } from "@/components/forms/native-select";
import { SubmitButton } from "@/components/forms/submit-button";
import { FieldError, TextField } from "@/components/forms/text-field";
import { Label } from "@/components/ui/label";
import { useActionSubmit } from "@/hooks/use-action-submit";
import { GROUP_TYPE_OPTIONS } from "@/lib/groups/options";
import { CURRENCY_OPTIONS } from "@/lib/profile/options";
import { groupSettingsSchema } from "@/lib/validation/groups";
import { createGroup, updateGroup } from "@/server/actions/groups";

type Values = z.input<typeof groupSettingsSchema>;

/**
 * Create a group, or (with `groupId`) edit its settings. Changing the default
 * currency only affects new expenses.
 */
export function GroupForm({ defaultValues, groupId }: { defaultValues: Values; groupId?: string }) {
  const form = useForm<Values, unknown, z.output<typeof groupSettingsSchema>>({
    resolver: zodResolver(groupSettingsSchema),
    defaultValues,
  });
  const action = groupId ? (values: Values) => updateGroup({ ...values, groupId }) : createGroup;
  const { pending, submit, error, success } = useActionSubmit(action, form.setError);
  const { errors } = form.formState;
  const descriptionId = useId();
  const simplifyId = useId();

  return (
    <form noValidate onSubmit={form.handleSubmit(submit)} className="grid gap-5">
      <FormStatus error={error} success={success} />
      {/* defaultValue puts the saved values in the server HTML, before hydration. */}
      <TextField
        label="Group name"
        defaultValue={defaultValues.name}
        autoComplete="off"
        placeholder="e.g. Goa trip, Flat 4B"
        error={errors.name?.message}
        {...form.register("name")}
      />
      <div className="grid gap-2">
        <Label htmlFor={descriptionId}>Description (optional)</Label>
        <textarea
          id={descriptionId}
          rows={2}
          defaultValue={defaultValues.description}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={errors.description ? `${descriptionId}-error` : undefined}
          className="min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30"
          {...form.register("description")}
        />
        <FieldError id={`${descriptionId}-error`} message={errors.description?.message} />
      </div>
      <div className="grid items-start gap-5 sm:grid-cols-2">
        <NativeSelect
          label="Group type"
          options={GROUP_TYPE_OPTIONS}
          defaultValue={defaultValues.groupType}
          error={errors.groupType?.message}
          {...form.register("groupType")}
        />
        <NativeSelect
          label="Default currency"
          hint="For new expenses. Each expense can use another currency."
          options={CURRENCY_OPTIONS}
          defaultValue={defaultValues.defaultCurrency}
          error={errors.defaultCurrency?.message}
          {...form.register("defaultCurrency")}
        />
      </div>
      <div className="flex items-start gap-3 rounded-lg border p-3">
        <input
          id={simplifyId}
          type="checkbox"
          defaultChecked={defaultValues.simplifyDebts}
          aria-describedby={`${simplifyId}-hint`}
          className="mt-0.5 size-5 shrink-0 accent-(--primary)"
          {...form.register("simplifyDebts")}
        />
        <div className="grid gap-1">
          <Label htmlFor={simplifyId}>Simplify debts</Label>
          <p id={`${simplifyId}-hint`} className="text-xs text-muted-foreground">
            Suggest fewer repayments by combining what people owe across the group. Balances stay the same.
          </p>
        </div>
      </div>
      <SubmitButton pending={pending}>{groupId ? "Save changes" : "Create group"}</SubmitButton>
    </form>
  );
}

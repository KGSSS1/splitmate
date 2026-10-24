"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { FormStatus } from "@/components/forms/form-status";
import { SubmitButton } from "@/components/forms/submit-button";
import { useActionSubmit } from "@/hooks/use-action-submit";
import { NOTIFICATION_SECTIONS, NOTIFICATION_TYPE_INFO, NOTIFICATION_TYPES } from "@/lib/notifications/types";
import {
  notificationPreferencesSchema,
  type NotificationPreferencesValues,
} from "@/lib/validation/notifications";
import { saveNotificationPreferences } from "@/server/actions/notifications";

/** One checkbox per notification type, grouped like the notifications themselves. */
export function NotificationPreferencesForm({ defaultValues }: { defaultValues: NotificationPreferencesValues }) {
  const form = useForm<NotificationPreferencesValues>({
    resolver: zodResolver(notificationPreferencesSchema),
    defaultValues,
  });
  const { pending, submit, error, success } = useActionSubmit(saveNotificationPreferences, form.setError);

  return (
    <form noValidate onSubmit={form.handleSubmit(submit)} className="grid gap-5">
      <FormStatus error={error} success={success} />
      {NOTIFICATION_SECTIONS.map((section) => (
        <fieldset key={section} className="grid gap-1">
          <legend className="mb-1 text-sm font-medium">{section}</legend>
          {NOTIFICATION_TYPES.filter((type) => NOTIFICATION_TYPE_INFO[type].section === section).map((type) => (
            <label key={type} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5 shrink-0 accent-primary"
                defaultChecked={defaultValues[type]}
                {...form.register(type)}
              />
              {NOTIFICATION_TYPE_INFO[type].label}
            </label>
          ))}
        </fieldset>
      ))}
      <SubmitButton pending={pending} className="md:w-auto md:justify-self-start">
        Save notification settings
      </SubmitButton>
    </form>
  );
}

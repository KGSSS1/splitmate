"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { FormStatus } from "@/components/forms/form-status";
import { SubmitButton } from "@/components/forms/submit-button";
import { TextField } from "@/components/forms/text-field";
import { useActionSubmit } from "@/hooks/use-action-submit";
import { addFriendSchema } from "@/lib/validation/friends";
import { addFriend } from "@/server/actions/friends";

type Values = z.input<typeof addFriendSchema>;

/** Friend request by exact email address (there is no user directory, SPEC §2). */
export function AddFriendForm() {
  const form = useForm<Values, unknown, z.output<typeof addFriendSchema>>({
    resolver: zodResolver(addFriendSchema),
    defaultValues: { email: "" },
  });
  const action = async (values: z.output<typeof addFriendSchema>) => {
    const result = await addFriend(values);
    if (result.ok) form.reset({ email: "" });
    return result;
  };
  const { pending, submit, error, success } = useActionSubmit(action, form.setError);
  const { errors } = form.formState;

  return (
    <form noValidate onSubmit={form.handleSubmit(submit)} className="grid gap-3">
      {/* Outcomes about the email itself show under the field instead. */}
      <FormStatus error={errors.email ? null : error} success={success} />
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
        <TextField
          label="Friend's email"
          type="email"
          inputMode="email"
          autoComplete="off"
          hint="Their exact email address. They'll get a request to accept."
          error={errors.email?.message}
          {...form.register("email")}
        />
        <SubmitButton pending={pending} className="sm:mt-6 sm:w-auto">
          Send request
        </SubmitButton>
      </div>
    </form>
  );
}

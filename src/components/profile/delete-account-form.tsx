"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { FormStatus } from "@/components/forms/form-status";
import { SubmitButton } from "@/components/forms/submit-button";
import { TextField } from "@/components/forms/text-field";
import { useActionSubmit } from "@/hooks/use-action-submit";
import { DELETE_CONFIRMATION, deleteAccountSchema, type DeleteAccountValues } from "@/lib/validation/account";
import { deleteAccount } from "@/server/actions/account";

/** Typing DELETE is the confirmation; the server checks it again and refuses while balances are open. */
export function DeleteAccountForm() {
  const form = useForm<DeleteAccountValues>({
    resolver: zodResolver(deleteAccountSchema),
    defaultValues: { confirmation: "" },
  });
  const { pending, submit, error } = useActionSubmit(deleteAccount, form.setError);

  return (
    <form noValidate onSubmit={form.handleSubmit(submit)} className="grid gap-4">
      <FormStatus error={error} />
      <TextField
        label={`Type ${DELETE_CONFIRMATION} to confirm`}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        error={form.formState.errors.confirmation?.message}
        {...form.register("confirmation")}
      />
      <SubmitButton pending={pending} variant="destructive" className="md:w-auto md:justify-self-start">
        Delete my account
      </SubmitButton>
    </form>
  );
}

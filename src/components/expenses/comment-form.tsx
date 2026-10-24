"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { FormStatus } from "@/components/forms/form-status";
import { SubmitButton } from "@/components/forms/submit-button";
import { FieldError } from "@/components/forms/text-field";
import { Label } from "@/components/ui/label";
import { useActionSubmit } from "@/hooks/use-action-submit";
import { addCommentSchema } from "@/lib/validation/expenses";
import { addComment } from "@/server/actions/expenses";

type Values = z.input<typeof addCommentSchema>;

export function CommentForm({ expenseId }: { expenseId: string }) {
  const id = useId();
  const form = useForm<Values, unknown, z.output<typeof addCommentSchema>>({
    resolver: zodResolver(addCommentSchema),
    defaultValues: { expenseId, body: "" },
  });
  const action = async (values: z.output<typeof addCommentSchema>) => {
    const result = await addComment(values);
    if (result.ok) form.reset({ expenseId, body: "" });
    return result;
  };
  const { pending, submit, error } = useActionSubmit(action, form.setError);
  const bodyError = form.formState.errors.body?.message;

  return (
    <form noValidate onSubmit={form.handleSubmit(submit)} className="grid gap-3">
      <FormStatus error={error} />
      <div className="grid gap-2">
        <Label htmlFor={id}>Add a comment</Label>
        <textarea
          id={id}
          rows={2}
          aria-invalid={bodyError ? true : undefined}
          aria-describedby={bodyError ? `${id}-error` : undefined}
          className="min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30"
          {...form.register("body")}
        />
        <FieldError id={`${id}-error`} message={bodyError} />
      </div>
      <SubmitButton pending={pending} className="sm:w-auto sm:justify-self-start">
        Post comment
      </SubmitButton>
    </form>
  );
}

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";

import { FormStatus } from "@/components/forms/form-status";
import { NativeSelect } from "@/components/forms/native-select";
import { SubmitButton } from "@/components/forms/submit-button";
import { FieldError, TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useActionSubmit } from "@/hooks/use-action-submit";
import { createIdempotencyKey } from "@/lib/accounting/idempotency";
import { formatMoney } from "@/lib/money/format";
import { CURRENCY_OPTIONS } from "@/lib/profile/options";
import { SETTLEMENT_METHOD_OPTIONS, type SettlementDirection } from "@/lib/settlements/options";
import { cn } from "@/lib/utils";
import { settleUpFormSchema, type SettleUpFormValues } from "@/lib/validation/settlements";
import { createSettlement } from "@/server/actions/settlements";

/** A suggested repayment the viewer is part of, ready to fill in. */
export interface SettleUpSuggestion {
  personId: string;
  direction: SettlementDirection;
  /** Minor units. */
  amount: number;
  /** The amount as typed in the form, e.g. "300.00". */
  amountText: string;
  currency: string;
}

const TEXTAREA =
  "min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30";

/**
 * Record a repayment (SPEC §11). The viewer is always the payer or the
 * receiver; what happens next is explained before saving: a payment the
 * viewer made waits for the other person, one they received completes now.
 * Nothing is paid through SplitMate: UPI and bank transfers are recorded by hand.
 */
export function SettleUpForm({
  groupId,
  people,
  suggestions,
  defaultValues,
}: {
  /** null = a direct settlement with the only person in `people`. */
  groupId: string | null;
  people: readonly { id: string; name: string }[];
  suggestions: readonly SettleUpSuggestion[];
  defaultValues: SettleUpFormValues;
}) {
  const [idempotencyKey] = useState(createIdempotencyKey);
  const form = useForm<SettleUpFormValues, unknown, z.output<typeof settleUpFormSchema>>({
    resolver: zodResolver(settleUpFormSchema),
    defaultValues,
  });
  const { pending, submit, error } = useActionSubmit(
    (values: SettleUpFormValues) => createSettlement({ idempotencyKey, groupId, values }),
    form.setError,
  );
  const { errors } = form.formState;
  const values = useWatch({ control: form.control });
  const noteId = useId();
  const directionId = useId();

  const nameOf = (id: string | undefined) => people.find((person) => person.id === id)?.name ?? "them";
  const person = nameOf(values.personId);

  function applySuggestion(suggestion: SettleUpSuggestion) {
    form.setValue("personId", suggestion.personId, { shouldValidate: true });
    form.setValue("direction", suggestion.direction, { shouldValidate: true });
    form.setValue("amount", suggestion.amountText, { shouldValidate: true });
    form.setValue("currency", suggestion.currency, { shouldValidate: true });
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(submit)} className="grid gap-5">
      <FormStatus error={error} />

      {suggestions.length > 0 ? (
        <section aria-labelledby="suggestions-heading" className="grid gap-2">
          <h2 id="suggestions-heading" className="text-sm font-medium">
            Suggested
          </h2>
          <ul className="flex flex-wrap gap-2" aria-label="Suggested repayments">
            {suggestions.map((suggestion) => {
              const money = formatMoney(suggestion.amount, suggestion.currency);
              const label =
                suggestion.direction === "paid"
                  ? `You pay ${nameOf(suggestion.personId)} ${money}`
                  : `${nameOf(suggestion.personId)} pays you ${money}`;
              return (
                <li key={`${suggestion.personId}-${suggestion.currency}`}>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 md:h-9"
                    onClick={() => applySuggestion(suggestion)}
                  >
                    {label}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {groupId ? (
        <NativeSelect
          label="Settled with"
          options={[
            { value: "", label: "Choose a person" },
            ...people.map((option) => ({ value: option.id, label: option.name })),
          ]}
          defaultValue={defaultValues.personId}
          error={errors.personId?.message}
          {...form.register("personId")}
        />
      ) : (
        <input type="hidden" {...form.register("personId")} />
      )}

      <fieldset className="grid gap-2" aria-describedby={`${directionId}-hint`}>
        <legend className="mb-2 text-sm font-medium">Who paid?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["paid", `I paid ${person}`],
              ["received", `${person} paid me`],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm",
                values.direction === value && "border-primary bg-primary/5",
              )}
            >
              <input
                type="radio"
                value={value}
                className="size-4 accent-(--primary)"
                defaultChecked={defaultValues.direction === value}
                {...form.register("direction")}
              />
              {label}
            </label>
          ))}
        </div>
        <p id={`${directionId}-hint`} className="text-xs text-muted-foreground" aria-live="polite">
          {values.direction === "paid"
            ? `${person} will be asked to confirm it. Balances change once they do.`
            : "You're confirming you received it, so balances update right away."}
        </p>
        <FieldError id={`${directionId}-error`} message={errors.direction?.message} />
      </fieldset>

      <div className="grid items-start gap-5 sm:grid-cols-[1fr_10rem]">
        <TextField
          label="Amount"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={defaultValues.amount}
          error={errors.amount?.message}
          {...form.register("amount")}
        />
        <NativeSelect
          label="Currency"
          options={CURRENCY_OPTIONS}
          defaultValue={defaultValues.currency}
          error={errors.currency?.message}
          {...form.register("currency")}
        />
      </div>

      <div className="grid items-start gap-5 sm:grid-cols-2">
        <NativeSelect
          label="Paid with"
          options={SETTLEMENT_METHOD_OPTIONS}
          defaultValue={defaultValues.method}
          error={errors.method?.message}
          {...form.register("method")}
        />
        <TextField
          label="Paid on"
          type="date"
          defaultValue={defaultValues.settledOn}
          error={errors.settledOn?.message}
          {...form.register("settledOn")}
        />
      </div>

      {values.method === "upi" ? (
        <TextField
          label="UPI reference (optional)"
          autoComplete="off"
          hint="For your records only. SplitMate doesn't send or check payments."
          error={errors.upiReference?.message}
          {...form.register("upiReference")}
        />
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor={noteId}>Note (optional)</Label>
        <textarea
          id={noteId}
          rows={2}
          defaultValue={defaultValues.note}
          aria-invalid={errors.note ? true : undefined}
          aria-describedby={errors.note ? `${noteId}-error` : undefined}
          className={TEXTAREA}
          {...form.register("note")}
        />
        <FieldError id={`${noteId}-error`} message={errors.note?.message} />
      </div>

      <SubmitButton pending={pending}>Record payment</SubmitButton>
    </form>
  );
}

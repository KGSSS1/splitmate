"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";

import { FormStatus } from "@/components/forms/form-status";
import { NativeSelect } from "@/components/forms/native-select";
import { SubmitButton } from "@/components/forms/submit-button";
import { FieldError, TextField } from "@/components/forms/text-field";
import { Label } from "@/components/ui/label";
import { useActionSubmit } from "@/hooks/use-action-submit";
import { createIdempotencyKey } from "@/lib/accounting/idempotency";
import { formatMoney } from "@/lib/money/format";
import { SETTLEMENT_METHOD_OPTIONS } from "@/lib/settlements/options";
import { settleUpEverythingSchema, type SettleUpEverythingInput } from "@/lib/validation/settlements";
import { settleUpEverything } from "@/server/actions/settlements";
import type { NamedContextBalance } from "@/server/balances";

type Values = Omit<SettleUpEverythingInput, "idempotencyKey" | "friendId">;

/**
 * Friend-level "settle up everything" (SPEC §11): one settlement per group
 * and currency, recorded together. The list says beforehand which ones
 * complete now (the friend owes you) and which wait for them (you owe).
 */
export function SettleEverythingForm({
  friendId,
  friendName,
  balances,
  waiting = [],
}: {
  friendId: string;
  friendName: string;
  /** Only groups you are both still in, plus direct balances. */
  balances: readonly NamedContextBalance[];
  /** Left out: a payment between you two here is still waiting for confirmation. */
  waiting?: readonly NamedContextBalance[];
}) {
  // A fresh key after each success, so settling up again later is a new batch.
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  const schema = settleUpEverythingSchema.omit({ idempotencyKey: true, friendId: true });
  const form = useForm<Values, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { method: "cash", upiReference: "", note: "" },
  });
  const { pending, submit, error, success } = useActionSubmit(async (values: Values) => {
    const result = await settleUpEverything({ ...values, idempotencyKey, friendId });
    if (result.ok) setIdempotencyKey(createIdempotencyKey());
    return result;
  }, form.setError);
  const { errors } = form.formState;
  const method = useWatch({ control: form.control, name: "method" });
  const noteId = useId();

  return (
    <form noValidate onSubmit={form.handleSubmit(submit)} className="grid gap-4">
      <FormStatus error={error} success={success} />
      {waiting.length > 0 ? (
        <ul className="grid gap-1 text-sm text-muted-foreground" aria-label="Not included">
          {waiting.map((balance) => (
            <li key={`${balance.groupId ?? "direct"}-${balance.currency}`}>
              Not included: {balance.groupName ? `in ${balance.groupName}` : "outside groups"}, a payment between you
              two is waiting to be confirmed. Confirm, reject or withdraw it first.
            </li>
          ))}
        </ul>
      ) : null}
      {balances.length > 0 ? (
        <>
          <ul className="grid gap-2 text-sm" aria-label="What will be settled">
            {balances.map((balance) => {
              const money = formatMoney(Math.abs(balance.amount), balance.currency);
              const where = balance.groupName
                ? `in ${balance.groupName}${balance.simplified ? " (simplified plan)" : ""}`
                : "outside groups";
              return (
                <li key={`${balance.groupId ?? "direct"}-${balance.currency}`} className="rounded-lg border px-3 py-2">
                  {balance.amount > 0 ? (
                    <>
                      <span className="font-medium">
                        {friendName} pays you {money}
                      </span>{" "}
                      {where}. <span className="text-muted-foreground">Recorded as received now.</span>
                    </>
                  ) : (
                    <>
                      <span className="font-medium">
                        You pay {friendName} {money}
                      </span>{" "}
                      {where}. <span className="text-muted-foreground">{friendName} confirms it.</span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <NativeSelect
              label="Paid with"
              options={SETTLEMENT_METHOD_OPTIONS}
              error={errors.method?.message}
              {...form.register("method")}
            />
            {method === "upi" ? (
              <TextField
                label="UPI reference (optional)"
                autoComplete="off"
                error={errors.upiReference?.message}
                {...form.register("upiReference")}
              />
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor={noteId}>Note (optional)</Label>
            <textarea
              id={noteId}
              rows={2}
              aria-invalid={errors.note ? true : undefined}
              className="min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30"
              {...form.register("note")}
            />
            <FieldError id={`${noteId}-error`} message={errors.note?.message} />
          </div>
          <SubmitButton pending={pending}>Settle up everything</SubmitButton>
        </>
      ) : null}
    </form>
  );
}

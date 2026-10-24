"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Plus, Trash2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import {
  type Control,
  Controller,
  type FieldErrors,
  get,
  useFieldArray,
  useForm,
  type UseFormRegister,
  useWatch,
} from "react-hook-form";
import type { z } from "zod";

import { FormStatus } from "@/components/forms/form-status";
import { NativeSelect } from "@/components/forms/native-select";
import { SubmitButton } from "@/components/forms/submit-button";
import { FieldError, TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useActionSubmit } from "@/hooks/use-action-submit";
import { createIdempotencyKey } from "@/lib/accounting/idempotency";
import { blankPeople } from "@/lib/expenses/form-values";
import {
  ADJUSTMENT_KINDS,
  ADJUSTMENT_LABELS,
  EXPENSE_CATEGORIES,
  SPLIT_METHOD_LABELS,
  SPLIT_METHODS,
  type SplitMethod,
} from "@/lib/expenses/options";
import { type ExpenseFormValues, type ExpenseIssue, MULTIPLE_PAYERS, resolveExpense } from "@/lib/expenses/resolve";
import { isCurrencyCode } from "@/lib/money/currencies";
import { formatMoney, minorToDecimalString } from "@/lib/money/format";
import { CURRENCY_OPTIONS } from "@/lib/profile/options";
import { cn } from "@/lib/utils";
import { expenseFormSchema, parseSplitWith } from "@/lib/validation/expenses";
import { createExpense, updateExpense } from "@/server/actions/expenses";
import type { ExpenseFormOptions, ExpensePerson } from "@/server/expenses";

import { SplitPreview } from "./split-preview";

type Values = z.input<typeof expenseFormSchema>;

export type ExpenseFormMode =
  | { kind: "create" }
  | { kind: "edit"; expenseId: string; expectedVersion: number };

/** Everyone who can take part where the expense belongs: group members, or you and the friend. */
function peopleFor(options: ExpenseFormOptions, splitWith: string): ExpensePerson[] {
  const where = parseSplitWith(splitWith);
  if (where?.kind === "group") return options.groups.find((group) => group.id === where.id)?.members ?? [];
  if (where?.kind === "friend") {
    const friend = options.friends.find((person) => person.id === where.id);
    return friend ? [options.me, friend] : [options.me];
  }
  return [];
}

/**
 * Add or edit an expense (SPEC §10). Mobile first: one column on phones, the
 * live preview beside the form on wide screens. Saving is blocked until the
 * split resolves; the server resolves it again from the same values.
 */
export function ExpenseForm({
  options,
  defaultValues,
  mode,
}: {
  options: ExpenseFormOptions;
  defaultValues: Values;
  mode: ExpenseFormMode;
}) {
  // One key for the life of this form: retries and double submits reuse it (SPEC §6).
  const [idempotencyKey] = useState(createIdempotencyKey);
  const form = useForm<Values, unknown, z.output<typeof expenseFormSchema>>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues,
  });
  const { control, register } = form;
  const errors = form.formState.errors;

  const action = (values: Values) =>
    mode.kind === "create"
      ? createExpense({ idempotencyKey, values })
      : updateExpense({ expenseId: mode.expenseId, expectedVersion: mode.expectedVersion, values });
  const { pending, submit, error } = useActionSubmit(action, form.setError);

  const values = useWatch({ control }) as Values;
  const result = useMemo(() => resolveExpense(values as ExpenseFormValues), [values]);
  const people = peopleFor(options, values.splitWith);
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const person of [...options.groups.flatMap((group) => group.members), ...options.friends, options.me]) {
      map.set(person.id, person.id === options.me.id ? `${person.name} (you)` : person.name);
    }
    return map;
  }, [options]);
  const nameOf = (id: string) => names.get(id) ?? "Unknown member";
  // Input labels use the plain name ("Asha's share", not "Asha (you)'s share").
  const plainName = (id: string) => nameOf(id).replace(/ \(you\)$/, "");

  // Live problems at a path, shown inline once the user has typed something there.
  const issues = new Map<string, string>();
  const liveIssues: readonly ExpenseIssue[] = result.ok ? [] : result.issues;
  for (const issue of liveIssues) if (!issues.has(issue.path)) issues.set(issue.path, issue.message);
  const fieldError = (path: string): string | undefined => {
    const submitted = get(errors, path)?.message as string | undefined;
    if (submitted) return submitted;
    const typed = get(values, path);
    return typeof typed === "string" && typed.trim() !== "" ? issues.get(path) : undefined;
  };

  function changeSplitWith(next: string) {
    const nextPeople = peopleFor(options, next);
    const where = parseSplitWith(next);
    const group = where?.kind === "group" ? options.groups.find((g) => g.id === where.id) : undefined;
    form.reset({
      ...form.getValues(),
      splitWith: next,
      currency: group?.defaultCurrency ?? form.getValues("currency"),
      paidBy: options.me.id,
      people: blankPeople(nextPeople.map((person) => person.id)),
      items: [],
    });
  }

  const contextOptions = [
    ...options.groups.map((group) => ({ value: `group:${group.id}`, label: `Group · ${group.name}` })),
    ...options.friends.map((friend) => ({ value: `friend:${friend.id}`, label: `Friend · ${friend.name}` })),
  ];
  const payerOptions = [
    ...people.map((person) => ({ value: person.id, label: nameOf(person.id) })),
    ...(people.length > 1 ? [{ value: MULTIPLE_PAYERS, label: "More than one person" }] : []),
  ];
  // A stored category that isn't one of the presets stays selectable, so saving keeps it.
  const categoryOptions = [
    { value: "", label: "None" },
    ...EXPENSE_CATEGORIES,
    ...(defaultValues.category && !EXPENSE_CATEGORIES.some((c) => c.value === defaultValues.category)
      ? [{ value: defaultValues.category, label: defaultValues.category }]
      : []),
  ];
  const currency = values.currency;
  const format = (amount: number) => formatMoney(amount, currency);
  // "0", "0.00" or "0.000": the currency's own decimals (review L32).
  const amountHint = isCurrencyCode(currency) ? minorToDecimalString(0, currency) : "0.00";

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(submit)}
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start"
    >
      <div className="grid gap-6">
        <FormStatus error={error} />

        <Card>
          <CardContent className="grid gap-5">
            <Controller
              control={control}
              name="splitWith"
              render={({ field }) => (
                <NativeSelect
                  label="Split with"
                  options={contextOptions}
                  value={field.value}
                  disabled={mode.kind === "edit"}
                  hint={mode.kind === "edit" ? "An expense stays in its group or with its friend." : undefined}
                  onChange={(event) => changeSplitWith(event.target.value)}
                  error={errors.splitWith?.message}
                />
              )}
            />
            <TextField
              label="Description"
              autoComplete="off"
              placeholder="e.g. Dinner at Fisherman's Wharf"
              defaultValue={defaultValues.description}
              error={errors.description?.message}
              {...register("description")}
            />
            <div className="grid grid-cols-[minmax(0,1fr)_8rem] items-start gap-3">
              {values.splitMethod === "itemized" ? (
                <div className="grid gap-2">
                  <Label>Amount</Label>
                  <p className="flex h-11 items-center rounded-lg border bg-muted/50 px-2.5 tabular-nums md:h-9">
                    {result.ok ? format(result.expense.total) : "From the items below"}
                  </p>
                </div>
              ) : (
                <TextField
                  label="Amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={amountHint}
                  className="tabular-nums"
                  defaultValue={defaultValues.amount}
                  error={fieldError("amount")}
                  {...register("amount")}
                />
              )}
              <NativeSelect
                label="Currency"
                options={CURRENCY_OPTIONS.map((option) => ({ value: option.value, label: option.value }))}
                defaultValue={defaultValues.currency}
                error={errors.currency?.message}
                {...register("currency")}
              />
            </div>
            <div className="grid items-start gap-3 sm:grid-cols-2">
              <TextField
                label="Date"
                type="date"
                defaultValue={defaultValues.date}
                error={errors.date?.message}
                {...register("date")}
              />
              <NativeSelect
                label="Category"
                options={categoryOptions}
                defaultValue={defaultValues.category}
                {...register("category")}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-4">
            <NativeSelect
              label="Paid by"
              options={payerOptions}
              defaultValue={defaultValues.paidBy}
              error={fieldError("paidBy") ?? errors.paidBy?.message}
              {...register("paidBy")}
            />
            {values.paidBy === MULTIPLE_PAYERS ? (
              <div className="grid gap-3">
                {values.people.map((person, index) => (
                  <MoneyRow
                    key={person.userId}
                    label={`Amount ${plainName(person.userId)} paid`}
                    inputMode="decimal"
                    error={fieldError(`people.${index}.paid`)}
                    {...register(`people.${index}.paid`)}
                  />
                ))}
                <FieldError id="payers-error" message={issues.get("payers") ?? get(errors, "payers")?.message} />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-4">
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">Split</legend>
              <div className="flex flex-wrap gap-2">
                {SPLIT_METHODS.map((method) => (
                  <label
                    key={method}
                    className={cn(
                      "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm md:min-h-8",
                      "has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:checked]:text-primary-emphasis",
                      "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                    )}
                  >
                    <input type="radio" value={method} className="sr-only" {...register("splitMethod")} />
                    {/* A check, not just colour, marks the choice (review L19). */}
                    {values.splitMethod === method ? (
                      <Check aria-hidden data-checked-indicator className="size-4" />
                    ) : null}
                    {SPLIT_METHOD_LABELS[method]}
                  </label>
                ))}
              </div>
            </fieldset>

            {values.splitMethod === "itemized" ? (
              <ItemizedEditor
                amountHint={amountHint}
                control={control}
                register={register}
                people={people}
                nameOf={nameOf}
                fieldError={fieldError}
                issues={issues}
                errors={errors}
              />
            ) : (
              <PeopleSplit
                method={values.splitMethod}
                values={values}
                register={register}
                nameOf={nameOf}
                plainName={plainName}
                fieldError={fieldError}
              />
            )}
            <FieldError id="people-error" message={issues.get("people") ?? get(errors, "people")?.message} />
          </CardContent>
        </Card>

        <details className="group rounded-xl border px-4 open:pb-4 md:py-1.5">
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium md:min-h-8 md:py-1.5">Notes and tags</summary>
          <div className="mt-4 grid gap-4">
            <Textarea
              label="Notes"
              defaultValue={defaultValues.notes}
              error={errors.notes?.message}
              {...register("notes")}
            />
            <TextField
              label="Tags"
              hint="Separate tags with commas, e.g. goa, beach."
              autoComplete="off"
              defaultValue={defaultValues.tags}
              error={errors.tags?.message}
              {...register("tags")}
            />
          </div>
        </details>
      </div>

      <div className="grid gap-4 lg:sticky lg:top-6">
        <Card>
          <CardContent>
            <SplitPreview result={result} currency={currency} nameOf={nameOf} />
          </CardContent>
        </Card>
        <SubmitButton pending={pending} disabled={!result.ok}>
          {mode.kind === "create" ? "Save expense" : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}

/** Equal, exact, percentage and shares: one row per person, each can be left out. */
function PeopleSplit({
  method,
  values,
  register,
  nameOf,
  plainName,
  fieldError,
}: {
  method: Exclude<SplitMethod, "itemized">;
  values: Values;
  register: UseFormRegister<Values>;
  nameOf: (id: string) => string;
  plainName: (id: string) => string;
  fieldError: (path: string) => string | undefined;
}) {
  const field = method === "exact" ? "exact" : method === "percentage" ? "percent" : method === "shares" ? "shares" : null;
  const suffix = method === "percentage" ? "%" : method === "shares" ? "shares" : undefined;
  return (
    <ul className="grid gap-3" aria-label="People in the split">
      {values.people.map((person, index) => {
        const name = plainName(person.userId);
        return (
          <li key={person.userId} className="grid grid-cols-[minmax(0,1fr)_9rem] items-start gap-3">
            <label className="flex min-h-11 items-center gap-3 md:min-h-9">
              <input
                type="checkbox"
                className="size-5 shrink-0 accent-(--primary)"
                aria-label={`Include ${name}`}
                {...register(`people.${index}.included`)}
              />
              <span className="truncate text-sm">{nameOf(person.userId)}</span>
            </label>
            {field && person.included ? (
              <MoneyRow
                label={
                  method === "exact" ? `${name}'s share` : method === "percentage" ? `${name}'s percentage` : `${name}'s shares`
                }
                inputMode={method === "shares" ? "numeric" : "decimal"}
                suffix={suffix}
                error={fieldError(`people.${index}.${field}`)}
                {...register(`people.${index}.${field}`)}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function ItemizedEditor({
  amountHint,
  control,
  register,
  people,
  nameOf,
  fieldError,
  issues,
  errors,
}: {
  amountHint: string;
  control: Control<Values>;
  register: UseFormRegister<Values>;
  people: ExpensePerson[];
  nameOf: (id: string) => string;
  fieldError: (path: string) => string | undefined;
  issues: Map<string, string>;
  errors: FieldErrors<Values>;
}) {
  const items = useFieldArray({ control, name: "items" });
  const adjustments = useFieldArray({ control, name: "adjustments" });
  const watchedItems = useWatch({ control, name: "items" });

  return (
    <div className="grid gap-5">
      <ul className="grid gap-4" aria-label="Items">
        {items.fields.map((item, index) => {
          const started = Boolean(watchedItems?.[index]?.name || watchedItems?.[index]?.amount);
          return (
            <li key={item.id} className="grid gap-3 rounded-lg border p-3">
              <div className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-start gap-2">
                <TextField
                  label={`Item ${index + 1}`}
                  autoComplete="off"
                  placeholder="e.g. Pizza"
                  error={started ? fieldError(`items.${index}.name`) ?? issues.get(`items.${index}.name`) : fieldError(`items.${index}.name`)}
                  {...register(`items.${index}.name`)}
                />
                <TextField
                  label={`Item ${index + 1} amount`}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={amountHint}
                  error={fieldError(`items.${index}.amount`)}
                  {...register(`items.${index}.amount`)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mt-6 size-11 md:size-9"
                  aria-label={`Remove item ${index + 1}`}
                  onClick={() => items.remove(index)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
              <Controller
                control={control}
                name={`items.${index}.assignees`}
                render={({ field }) => (
                  <fieldset className="grid gap-2">
                    <legend className="mb-1 text-xs text-muted-foreground">Shared by</legend>
                    <div className="flex flex-wrap gap-2">
                      {people.map((person) => {
                        const checked = field.value.includes(person.id);
                        return (
                          <label
                            key={person.id}
                            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10 md:min-h-8"
                          >
                            <input
                              type="checkbox"
                              className="accent-(--primary)"
                              aria-label={`${nameOf(person.id)} shares item ${index + 1}`}
                              checked={checked}
                              onChange={() =>
                                field.onChange(
                                  checked ? field.value.filter((id) => id !== person.id) : [...field.value, person.id],
                                )
                              }
                            />
                            {nameOf(person.id)}
                          </label>
                        );
                      })}
                    </div>
                    <FieldError
                      id={`item-${index}-assignees-error`}
                      message={started ? issues.get(`items.${index}.assignees`) : undefined}
                    />
                  </fieldset>
                )}
              />
            </li>
          );
        })}
      </ul>
      <Button
        type="button"
        variant="outline"
        className="h-11 justify-self-start md:h-9"
        onClick={() => items.append({ name: "", amount: "", assignees: people.map((person) => person.id) })}
      >
        <Plus aria-hidden />
        Add item
      </Button>
      <FieldError id="items-error" message={issues.get("items") ?? get(errors, "items")?.message} />

      <div className="grid gap-3 border-t pt-4">
        <h3 className="text-sm font-medium">Tax, service, tip and discounts</h3>
        <p className="text-xs text-muted-foreground">
          Shared in proportion to what each person ordered, unless you choose equally.
        </p>
        <ul className="grid gap-3" aria-label="Tax, service, tip and discounts">
          {adjustments.fields.map((adjustment, index) => (
            <li
              key={adjustment.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto]"
            >
              {/* Full width on phones so "Proportionally" fits (review L24). */}
              <div className="col-span-2 grid gap-2 sm:col-span-1 sm:grid-cols-2">
                <NativeSelect
                  label={`Line ${index + 1} type`}
                  options={ADJUSTMENT_KINDS.map((kind) => ({ value: kind, label: ADJUSTMENT_LABELS[kind] }))}
                  {...register(`adjustments.${index}.kind`)}
                />
                <NativeSelect
                  label={`Line ${index + 1} split`}
                  options={[
                    { value: "proportional", label: "Proportionally" },
                    { value: "equal", label: "Equally" },
                  ]}
                  {...register(`adjustments.${index}.allocation`)}
                />
              </div>
              <TextField
                label={`Line ${index + 1} amount`}
                inputMode="decimal"
                autoComplete="off"
                placeholder={amountHint}
                error={fieldError(`adjustments.${index}.amount`)}
                {...register(`adjustments.${index}.amount`)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-6 size-11 md:size-9"
                aria-label={`Remove line ${index + 1}`}
                onClick={() => adjustments.remove(index)}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          className="h-11 justify-self-start md:h-9"
          onClick={() => adjustments.append({ kind: "tax", amount: "", allocation: "proportional" })}
        >
          <Plus aria-hidden />
          Add tax, tip or discount
        </Button>
      </div>
    </div>
  );
}

/** A compact labelled amount input, optionally with a suffix like "%". */
/** `name` and the handlers come from `register`: React Hook Form reads `event.target.name`. */
function MoneyRow({
  label,
  suffix,
  error,
  ...props
}: React.ComponentProps<"input"> & { label: string; suffix?: string; error?: string }) {
  const id = useId();
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2">
        <Label htmlFor={id} className="sr-only">
          {label}
        </Label>
        <Input
          id={id}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="h-11 text-right tabular-nums md:h-9"
          {...props}
        />
        {suffix ? <span className="w-12 shrink-0 text-xs text-muted-foreground">{suffix}</span> : null}
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

function Textarea({
  label,
  error,
  ...props
}: React.ComponentProps<"textarea"> & { label: string; error?: string }) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        rows={3}
        aria-invalid={error ? true : undefined}
        className="min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30"
        {...props}
      />
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

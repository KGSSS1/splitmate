"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Link2, Mail } from "lucide-react";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { FormStatus } from "@/components/forms/form-status";
import { NativeSelect } from "@/components/forms/native-select";
import { SubmitButton } from "@/components/forms/submit-button";
import { TextField } from "@/components/forms/text-field";
import { CopyField } from "@/components/shared/copy-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { useActionSubmit } from "@/hooks/use-action-submit";
import { DEFAULT_INVITE_EXPIRY_DAYS, DEFAULT_LINK_MAX_USES, INVITE_EXPIRY_DAYS } from "@/lib/groups/options";
import { cn } from "@/lib/utils";
import { createEmailInviteSchema } from "@/lib/validation/groups";
import type { ActionResult } from "@/server/action-result";
import { type CreatedInvite, createEmailInvite, createInviteLink } from "@/server/actions/invitations";

const EXPIRY_OPTIONS = INVITE_EXPIRY_DAYS.map((days) => ({
  value: String(days),
  label: days === 1 ? "1 day" : `${days} days`,
}));

const ONCE_NOTICE = "Copy it now: for security, the link can't be shown again. You can revoke it below.";

/** Create a shareable invitation link, or a single-use invitation for one email address. */
export function InvitePanel({ groupId }: { groupId: string }) {
  return (
    <div className="grid gap-8">
      <LinkInvite groupId={groupId} />
      <EmailInvite groupId={groupId} />
    </div>
  );
}

function LinkInvite({ groupId }: { groupId: string }) {
  const [expiresInDays, setExpiresInDays] = useState(String(DEFAULT_INVITE_EXPIRY_DAYS));
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult<CreatedInvite> | null>(null);

  function create() {
    setResult(null);
    startTransition(async () => {
      let next: ActionResult<CreatedInvite>;
      try {
        next = await createInviteLink({ groupId, expiresInDays });
      } catch {
        next = { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
      }
      // Commit the result with the re-enabled button (review M17).
      startTransition(() => setResult(next));
    });
  }

  return (
    <section aria-labelledby="invite-link-heading" className="grid gap-3">
      <div className="grid gap-1">
        <h3 id="invite-link-heading" className="flex items-center gap-2 font-medium">
          <Link2 aria-hidden className="size-4" />
          Invite with a link
        </h3>
        <p className="text-sm text-muted-foreground">
          Anyone with the link can join, up to {DEFAULT_LINK_MAX_USES} people, until it expires.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <NativeSelect
          label="Link expires after"
          options={EXPIRY_OPTIONS}
          value={expiresInDays}
          onChange={(event) => setExpiresInDays(event.target.value)}
        />
        <Button type="button" className="h-11 md:h-9" disabled={pending} aria-busy={pending || undefined} onClick={create}>
          Create invite link
        </Button>
      </div>
      {result && !result.ok ? <FormStatus error={result.error} /> : null}
      {result?.ok && result.data ? (
        <div className="grid gap-1 rounded-lg border border-primary/30 p-3">
          <CopyField label="Invite link" value={result.data.url} />
          <p className="text-xs text-muted-foreground">{ONCE_NOTICE}</p>
        </div>
      ) : null}
    </section>
  );
}

type EmailValues = z.input<typeof createEmailInviteSchema>;

function EmailInvite({ groupId }: { groupId: string }) {
  const form = useForm<EmailValues, unknown, z.output<typeof createEmailInviteSchema>>({
    resolver: zodResolver(createEmailInviteSchema),
    defaultValues: { groupId, email: "", expiresInDays: DEFAULT_INVITE_EXPIRY_DAYS },
  });
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const action = async (values: z.output<typeof createEmailInviteSchema>) => {
    setCreated(null);
    const result = await createEmailInvite(values);
    if (result.ok && result.data) {
      setCreated(result.data);
      form.reset({ groupId, email: "", expiresInDays: values.expiresInDays });
    }
    return result;
  };
  const { pending, submit, error } = useActionSubmit(action, form.setError);
  const { errors } = form.formState;

  return (
    <section aria-labelledby="invite-email-heading" className="grid gap-3">
      <div className="grid gap-1">
        <h3 id="invite-email-heading" className="flex items-center gap-2 font-medium">
          <Mail aria-hidden className="size-4" />
          Invite by email
        </h3>
        <p className="text-sm text-muted-foreground">
          A single-use invitation only that email address can accept. If they already have an account, they also see
          it in the app. Send them the link from your own email.
        </p>
      </div>
      <form noValidate onSubmit={form.handleSubmit(submit)} className="grid gap-3">
        <FormStatus error={error} />
        <div className="grid items-start gap-3 sm:grid-cols-[2fr_1fr]">
          <TextField
            label="Email address"
            type="email"
            inputMode="email"
            autoComplete="off"
            error={errors.email?.message}
            {...form.register("email")}
          />
          <NativeSelect
            label="Expires after"
            options={EXPIRY_OPTIONS}
            error={errors.expiresInDays?.message}
            {...form.register("expiresInDays")}
          />
        </div>
        <SubmitButton pending={pending} className="sm:w-auto sm:justify-self-start">
          Create email invitation
        </SubmitButton>
      </form>
      {created ? (
        <div className="grid gap-3 rounded-lg border border-primary/30 p-3">
          <CopyField label="Invitation link" value={created.url} />
          {created.mailto ? (
            <a href={created.mailto} className={cn(buttonVariants({ variant: "outline" }), "h-11 justify-self-start md:h-9")}>
              <Mail aria-hidden />
              Open in my email app
            </a>
          ) : null}
          <p className="text-xs text-muted-foreground">{ONCE_NOTICE}</p>
        </div>
      ) : null}
    </section>
  );
}

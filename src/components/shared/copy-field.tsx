"use client";

import { Check, Copy } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** A read-only value (such as an invitation link) with a copy button. */
export function CopyField({ label, value }: { label: string; value: string }) {
  const id = useId();
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          readOnly
          value={value}
          className="h-11 font-mono text-xs md:h-9"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button type="button" variant="outline" className="h-11 md:h-9" onClick={copy}>
          {status === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
          {status === "copied" ? "Copied" : "Copy"}
        </Button>
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {status === "failed" ? "Couldn't copy automatically. Select the link and copy it." : null}
      </p>
    </div>
  );
}

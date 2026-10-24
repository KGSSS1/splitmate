import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useActionSubmit } from "@/hooks/use-action-submit";
import type { ActionResult } from "@/server/action-result";

type Frame = { pending: boolean; error: string | null };

/**
 * Review M17: the result used to be set after the await, outside the
 * transition, so React could commit the error while `pending` (the disabled
 * Save button) was still true, and a quick retry click landed on a disabled
 * button. Every render is recorded so an in-between frame can't hide.
 */
function Probe({
  action,
  frames,
  onSubmit,
}: {
  action: () => Promise<ActionResult<unknown>>;
  frames: Frame[];
  onSubmit: (submit: () => void) => void;
}) {
  const { pending, submit, error } = useActionSubmit<{ x: string }, void>(action, () => {});
  frames.push({ pending, error });
  onSubmit(() => submit());
  return <p>{error ?? (pending ? "pending" : "idle")}</p>;
}

describe("useActionSubmit", () => {
  it("never shows the result while still pending", async () => {
    const frames: Frame[] = [];
    let release: (result: ActionResult<unknown>) => void = () => {};
    const action = () =>
      new Promise<ActionResult<unknown>>((resolve) => {
        release = resolve;
      });
    let submit = () => {};
    render(<Probe action={action} frames={frames} onSubmit={(s) => (submit = s)} />);

    act(() => submit());
    expect(await screen.findByText("pending")).toBeInTheDocument();
    await act(async () => release({ ok: false, error: "Nope" }));
    expect(await screen.findByText("Nope")).toBeInTheDocument();

    expect(frames.filter((f) => f.pending && f.error !== null)).toEqual([]);
    expect(frames.at(-1)).toEqual({ pending: false, error: "Nope" });
  });

  it("keeps a thrown action from leaving the form pending", async () => {
    const frames: Frame[] = [];
    let submit = () => {};
    render(<Probe action={() => Promise.reject(new Error("offline"))} frames={frames} onSubmit={(s) => (submit = s)} />);
    await act(async () => submit());
    expect(await screen.findByText(/Couldn't reach the server/)).toBeInTheDocument();
    expect(frames.filter((f) => f.pending && f.error !== null)).toEqual([]);
  });
});

import { Profiler } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ActionButton } from "@/components/shared/action-button";
import type { ActionResult } from "@/server/action-result";

describe("ActionButton", () => {
  // Review M17: the error used to commit before the button was re-enabled.
  // The Profiler callback runs at every commit, after the DOM is updated.
  it("shows the error and re-enables the button in the same commit", async () => {
    let release: (result: ActionResult) => void = () => {};
    const action = () =>
      new Promise<ActionResult>((resolve) => {
        release = resolve;
      });
    const badCommits: string[] = [];
    const check = () => {
      const alert = document.querySelector('[role="alert"]');
      const button = document.querySelector("button");
      if (alert && button?.disabled) badCommits.push(alert.textContent ?? "");
    };
    const user = userEvent.setup();
    render(
      <Profiler id="probe" onRender={check}>
        <ActionButton action={action}>Remind</ActionButton>
      </Profiler>,
    );

    await user.click(screen.getByRole("button", { name: "Remind" }));
    expect(screen.getByRole("button", { name: "Remind" })).toBeDisabled();
    await act(async () => release({ ok: false, error: "Try later" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Try later");
    expect(screen.getByRole("button", { name: "Remind" })).toBeEnabled();
    expect(badCommits).toEqual([]);
  });

  it("asks first when it needs confirmation", async () => {
    const action = vi.fn(async (): Promise<ActionResult> => ({ ok: true, data: undefined }));
    const user = userEvent.setup();
    render(
      <ActionButton action={action} confirm="Really?">
        Withdraw
      </ActionButton>,
    );
    await user.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(screen.getByText("Really?")).toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
  });

  // Review L18: "Cancel" next to "Cancel expense" was ambiguous.
  it("labels the way out of a confirmation unambiguously", async () => {
    const user = userEvent.setup();
    render(
      <ActionButton action={async () => ({ ok: true })} confirm="Cancel this expense?" confirmLabel="Cancel expense">
        Cancel expense
      </ActionButton>,
    );
    await user.click(screen.getByRole("button", { name: "Cancel expense" }));
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.getByRole("button", { name: "Keep it" })).toBeInTheDocument();
  });

  // Review L27: the button that had focus is replaced, so focus used to drop to <body>.
  it("moves focus into the confirmation and back", async () => {
    const user = userEvent.setup();
    render(
      <ActionButton action={async () => ({ ok: true })} confirm="Remove Bina?" confirmLabel="Remove">
        Remove member
      </ActionButton>,
    );
    await user.click(screen.getByRole("button", { name: "Remove member" }));
    expect(screen.getByRole("button", { name: "Remove" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.getByRole("button", { name: "Remove member" })).toHaveFocus();
  });
});

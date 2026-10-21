import { describe, expect, it } from "vitest";

import { authErrorMessage, GENERIC_AUTH_ERROR } from "@/lib/auth/errors";

describe("authErrorMessage", () => {
  it("maps known Supabase Auth codes to friendly messages", () => {
    expect(authErrorMessage("invalid_credentials")).toBe("Incorrect email or password.");
    expect(authErrorMessage("email_not_confirmed")).toMatch(/Confirm your email/);
    expect(authErrorMessage("over_email_send_rate_limit")).toMatch(/Too many emails/);
    expect(authErrorMessage("email_address_not_authorized")).toMatch(/can't send email to that address/);
  });

  it("never passes unknown codes or raw messages through", () => {
    expect(authErrorMessage(undefined)).toBe(GENERIC_AUTH_ERROR);
    expect(authErrorMessage("unexpected_failure")).toBe(GENERIC_AUTH_ERROR);
    expect(authErrorMessage("constructor")).toBe(GENERIC_AUTH_ERROR);
  });
});

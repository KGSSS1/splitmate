import { describe, expect, it } from "vitest";

import { CURRENCY_OPTIONS, timeZoneOptions } from "@/lib/profile/options";
import { isValidTimeZone, onboardingSchema } from "@/lib/validation/profile";

describe("profile schemas", () => {
  const valid = { displayName: "  Asha  ", defaultCurrency: "INR", timeZone: "Asia/Kolkata" };

  it("trims the display name", () => {
    expect(onboardingSchema.parse(valid).displayName).toBe("Asha");
  });

  it("rejects blank or overlong names", () => {
    expect(onboardingSchema.safeParse({ ...valid, displayName: "   " }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...valid, displayName: "a".repeat(81) }).success).toBe(false);
  });

  it("only accepts supported currencies", () => {
    expect(onboardingSchema.safeParse({ ...valid, defaultCurrency: "JPY" }).success).toBe(true);
    expect(onboardingSchema.safeParse({ ...valid, defaultCurrency: "XYZ" }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...valid, defaultCurrency: "inr" }).success).toBe(false);
  });

  it("only accepts real IANA time zones", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(onboardingSchema.safeParse({ ...valid, timeZone: "Nowhere" }).success).toBe(false);
  });
});

describe("profile options", () => {
  it("lists every supported currency once, sorted by code", () => {
    const codes = CURRENCY_OPTIONS.map((option) => option.value);
    expect(codes).toContain("INR");
    expect(new Set(codes).size).toBe(codes.length);
    expect([...codes].sort()).toEqual(codes);
  });

  it("always includes the user's current time zone", () => {
    const options = timeZoneOptions("UTC").map((option) => option.value);
    expect(options).toContain("UTC");
    expect(options).toContain("Europe/London");
    // ICU lists India as "Asia/Calcutta"; the profile default "Asia/Kolkata" is added explicitly.
    expect(timeZoneOptions("Asia/Kolkata").map((option) => option.value)).toContain("Asia/Kolkata");
  });
});

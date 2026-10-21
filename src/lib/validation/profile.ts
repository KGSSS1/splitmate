import { z } from "zod";

import { isCurrencyCode } from "@/lib/money/currencies";

export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

/** True for IANA time zone names the runtime understands (e.g. "Asia/Kolkata"). */
export function isValidTimeZone(value: string): boolean {
  if (value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Enter your name.")
  .max(80, "Keep your name under 80 characters.");

export const currencySchema = z
  .string()
  .refine(isCurrencyCode, { error: "Choose a supported currency." });

export const timeZoneSchema = z
  .string()
  .refine(isValidTimeZone, { error: "Choose a valid time zone." });

export const onboardingSchema = z.object({
  displayName: displayNameSchema,
  defaultCurrency: currencySchema,
  timeZone: timeZoneSchema,
});

export const profileSettingsSchema = onboardingSchema;

export type OnboardingInput = z.input<typeof onboardingSchema>;
export type ProfileSettingsInput = z.input<typeof profileSettingsSchema>;

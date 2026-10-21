import { describe, expect, it } from "vitest";

import { EnvError, parseClientEnv, parseServerEnv, validateEnv } from "@/lib/env";

const validEnv = {
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  CRON_SECRET: "",
  EMAIL_PROVIDER_API_KEY: "",
  EMAIL_FROM_ADDRESS: "",
  EXCHANGE_RATE_API_KEY: "",
};

describe("env validation", () => {
  it("accepts a complete environment and treats empty optionals as unset", () => {
    expect(() => validateEnv(validEnv)).not.toThrow();
    expect(parseClientEnv(validEnv).NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(parseServerEnv(validEnv).CRON_SECRET).toBeUndefined();
  });

  it("lists every missing variable in one error", () => {
    expect(() => validateEnv({})).toThrow(EnvError);
    expect(() => validateEnv({})).toThrow(/NEXT_PUBLIC_SUPABASE_URL is missing/);
    expect(() => validateEnv({})).toThrow(/SUPABASE_SECRET_KEY is missing/);
  });

  it("rejects a secret key placed in a public variable", () => {
    expect(() =>
      parseClientEnv({ ...validEnv, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_oops" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY contains a secret key/);
  });

  it("rejects keys of the wrong kind", () => {
    expect(() => parseServerEnv({ ...validEnv, SUPABASE_SECRET_KEY: "eyJlegacy" })).toThrow(
      /SUPABASE_SECRET_KEY must be a secret key/,
    );
  });
});

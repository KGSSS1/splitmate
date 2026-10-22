import { describe, expect, it } from "vitest";

import { EnvError, parseClientEnv, parseServerEnv, resolveAppUrl, validateEnv } from "@/lib/env";

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
    expect(() => validateEnv({})).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing/);
  });

  it("does not require the secret key until something uses it", () => {
    expect(() => validateEnv({ ...validEnv, SUPABASE_SECRET_KEY: "" })).not.toThrow();
    expect(parseServerEnv({ ...validEnv, SUPABASE_SECRET_KEY: undefined }).SUPABASE_SECRET_KEY).toBeUndefined();
  });

  it("rejects a secret key placed in a public variable", () => {
    expect(() =>
      parseClientEnv({ ...validEnv, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_oops" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY contains a secret key/);
  });

  it("uses the stable branch URL on previews, else the deployment URL", () => {
    const vercel = { VERCEL_ENV: "preview", VERCEL_URL: "splitmate-abc123-team.vercel.app" };
    expect(resolveAppUrl(vercel)).toBe("https://splitmate-abc123-team.vercel.app");
    expect(resolveAppUrl({ ...vercel, VERCEL_BRANCH_URL: "splitmate-git-staging-team.vercel.app" })).toBe(
      "https://splitmate-git-staging-team.vercel.app",
    );
    // CLI deployments have no branch; Vercel may pass the variable empty.
    expect(resolveAppUrl({ ...vercel, VERCEL_BRANCH_URL: "" })).toBe("https://splitmate-abc123-team.vercel.app");
    expect(resolveAppUrl({ ...vercel, NEXT_PUBLIC_APP_URL: "https://staging.example.com" })).toBe(
      "https://staging.example.com",
    );
    // Production must always set NEXT_PUBLIC_APP_URL explicitly.
    expect(resolveAppUrl({ ...vercel, VERCEL_ENV: "production" })).toBeUndefined();
    expect(resolveAppUrl({})).toBeUndefined();
  });

  it("requires an explicit app URL on Vercel Production, with Vercel-specific advice", () => {
    const production = { ...validEnv, NEXT_PUBLIC_APP_URL: "", VERCEL: "1", VERCEL_ENV: "production" };
    expect(resolveAppUrl({ ...production, VERCEL_URL: "splitmate-abc-team.vercel.app" })).toBeUndefined();
    expect(() => validateEnv(production)).toThrow(/Vercel Production must set it explicitly/);
    expect(() => validateEnv(production)).toThrow(/Settings → Environment Variables/);
    expect(() => validateEnv(production)).not.toThrow(/\.env\.local/);
  });

  it("keeps the local-setup advice outside Vercel", () => {
    expect(() => validateEnv({ ...validEnv, NEXT_PUBLIC_APP_URL: "" })).toThrow(/Copy \.env\.example to \.env\.local/);
  });

  it("rejects keys of the wrong kind", () => {
    expect(() => parseServerEnv({ ...validEnv, SUPABASE_SECRET_KEY: "eyJlegacy" })).toThrow(
      /SUPABASE_SECRET_KEY must be a secret key/,
    );
  });
});

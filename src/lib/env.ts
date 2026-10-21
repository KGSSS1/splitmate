import { z } from "zod";

/**
 * Validated environment variables (SPEC §18).
 *
 * - Client variables (NEXT_PUBLIC_*) are read through explicit `process.env.X`
 *   references so Next.js can inline them into the browser bundle.
 * - Server variables are only readable on the server; `getServerEnv()` throws
 *   if it is ever called in the browser.
 * - `validateEnv()` runs from next.config.ts so `next dev` / `next build`
 *   fail fast with a readable list of problems.
 *
 * This module must not import path aliases ("@/...") because next.config.ts
 * imports it directly.
 */

type EnvSource = Record<string, string | undefined>;

/** Treats an empty string (e.g. `KEY=` in .env files) as "not set". */
const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().startsWith("sb_publishable_", {
    error: "must be a publishable key (sb_publishable_...)",
  }),
});

const serverSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().startsWith("sb_secret_", {
    error: "must be a secret key (sb_secret_...)",
  }),
  CRON_SECRET: optionalString,
  EMAIL_PROVIDER_API_KEY: optionalString,
  EMAIL_FROM_ADDRESS: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.email().optional(),
  ),
  EXCHANGE_RATE_API_KEY: optionalString,
});

export type ClientEnv = z.infer<typeof clientSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

export class EnvError extends Error {
  constructor(problems: string[]) {
    super(
      [
        "Invalid environment variables:",
        ...problems.map((problem) => `  - ${problem}`),
        "Copy .env.example to .env.local and fill in the values (see README.md).",
      ].join("\n"),
    );
    this.name = "EnvError";
  }
}

function collectProblems(schema: z.ZodType, source: EnvSource): string[] {
  const result = schema.safeParse(source);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const key = String(issue.path[0]);
    const value = source[key];
    const message = value === undefined || value === "" ? "is missing" : issue.message;
    return `${key} ${message}`;
  });
}

/** A secret key in a NEXT_PUBLIC_ variable would be shipped to every browser. */
function collectLeakedSecrets(source: EnvSource): string[] {
  return Object.entries(source)
    .filter(([key, value]) => key.startsWith("NEXT_PUBLIC_") && value?.startsWith("sb_secret_"))
    .map(
      ([key]) =>
        `${key} contains a secret key (sb_secret_...); NEXT_PUBLIC_ variables are public, use SUPABASE_SECRET_KEY`,
    );
}

export function parseClientEnv(source: EnvSource): ClientEnv {
  const problems = [...collectLeakedSecrets(source), ...collectProblems(clientSchema, source)];
  if (problems.length > 0) throw new EnvError(problems);
  return clientSchema.parse(source);
}

export function parseServerEnv(source: EnvSource): ServerEnv {
  const problems = collectProblems(serverSchema, source);
  if (problems.length > 0) throw new EnvError(problems);
  return serverSchema.parse(source);
}

/** Validates every variable at once so all problems are reported together. */
export function validateEnv(source: EnvSource): void {
  const problems = [
    ...collectLeakedSecrets(source),
    ...collectProblems(clientSchema, source),
    ...collectProblems(serverSchema, source),
  ];
  if (problems.length > 0) throw new EnvError(problems);
}

let clientEnv: ClientEnv | undefined;

export function getClientEnv(): ClientEnv {
  clientEnv ??= parseClientEnv({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  return clientEnv;
}

let serverEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("getServerEnv() must only be called on the server.");
  }
  serverEnv ??= parseServerEnv(process.env);
  return serverEnv;
}

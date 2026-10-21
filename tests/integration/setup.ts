import { existsSync } from "node:fs";

// Same variables as `npm run dev`. Values already in the environment win.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
  throw new Error(
    `Integration tests only run against local Supabase; NEXT_PUBLIC_SUPABASE_URL is "${url}". ` +
      "Start it with `npm run db:start` and copy the values from `npx supabase status` into .env.local.",
  );
}

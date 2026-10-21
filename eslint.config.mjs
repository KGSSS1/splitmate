import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // SPEC §20: no `any` without a justifying comment (use an eslint-disable line with a reason).
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Tool output and generated files:
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "blob-report/**",
    "supabase/**",
    "src/types/database.types.ts",
  ]),
]);

export default eslintConfig;

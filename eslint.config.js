import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "build/**",
      ".cache/**",
      ".tools/**",
      "dist/**",
      "packages/*/dist/**",
      "apps/*/dist/**",
      "artifacts/**",
      ".wrangler/**",
      "research/**",
      "poc/**",
      "docs/**",
      "licenses/**",
      "fixtures/golden/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // AI output must never be executed: forbid every dynamic-code primitive.
      "no-eval": "error",
      "no-new-func": "error",
      "no-implied-eval": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        Buffer: "readonly",
        AbortController: "readonly",
      },
    },
  },
);

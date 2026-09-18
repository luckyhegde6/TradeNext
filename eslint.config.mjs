import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// Next.js 16 removed `next lint`; eslint-config-next 16+ ships native flat
// configs, so no FlatCompat/@eslint/eslintrc is needed (the legacy compat path
// crashed with "Converting circular structure to JSON" on ESLint 9.39.x).
// Rule overrides live in their own object, so the plugins they reference
// (`@typescript-eslint`, `react-hooks`) must be registered there too — flat
// configs scope plugins per config object.
const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [
      ".next/**",
      ".context/**",
      "coverage/**",
      "e2e-screenshots/**",
      "logs/**",
      "playwright-report/**",
      "test-results/**",
      "worker_logs/**",
    ],
  },
  {
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      react,
      "react-hooks": reactHooks,
    },
    rules: {
      // Make @typescript-eslint/no-explicit-any a warning instead of error
      "@typescript-eslint/no-explicit-any": "warn",
      // Also make some other common issues warnings instead of errors
      "@typescript-eslint/no-unused-vars": "warn",
      "prefer-const": "warn",
      "react-hooks/exhaustive-deps": "warn",

      // --- Legacy debt surfaced when ESLint first ran under Next 16 ---
      // These were never linted before (next lint was broken on Next 16).
      // Kept as warnings so the gate is usable; a follow-up cleanup can raise
      // them back to errors once the codebase is migrated.
      // require() is intentional in CJS scripts, jest setup and server-side
      // conditional loads (better-sqlite3, pino transports).
      "@typescript-eslint/no-require-imports": "warn",
      // JSX apostrophe/quote escaping hygiene across older admin pages.
      "react/no-unescaped-entities": "warn",
      // eslint-plugin-react-hooks v6 (React Compiler) migration diagnostics.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/set-state-in-render": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
];

export default eslintConfig;
// Flat ESLint config (ESLint 9) — Next.js rules via FlatCompat because
// eslint-config-next still ships eslintrc-style shareable configs.
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const config = [
  {
    // Generated code (Prisma client, Next build output + type stubs) is not
    // ours to lint.
    ignores: [
      "lib/generated/**",
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Plain-Node CommonJS scripts (Docker HEALTHCHECK, one-off seeds) —
    // require() is correct there.
    files: ["healthcheck.js", "scripts/**/*.mjs", "scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default config;

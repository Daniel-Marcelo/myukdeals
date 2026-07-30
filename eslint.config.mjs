import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored Claude skill scripts — CommonJS tooling, not app source. They are
    // committed, so CI lints them even when absent from a local working tree;
    // without this the lint job fails on their require() imports.
    ".claude/**",
  ]),
]);

export default eslintConfig;

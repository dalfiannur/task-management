/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  plugins: ["@typescript-eslint", "react-hooks", "react-refresh"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
  ],
  // Generated code (Connect clients + the router tree) is never hand-edited.
  ignorePatterns: [
    "dist",
    "node_modules",
    "src/routeTree.gen.ts",
    "src/lib/gen/**",
    "*.config.ts",
    "*.config.js",
    ".eslintrc.cjs",
  ],
  rules: {
    "react-refresh/only-export-components": [
      "warn",
      { allowConstantExport: true },
    ],
    // Allow intentionally-unused args/vars when prefixed with `_`.
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
  },
  overrides: [
    {
      // shadcn/ui primitives intentionally co-export a component + its
      // `*Variants` helper — fast-refresh purity doesn't apply to them.
      files: ["src/components/ui/**/*.{ts,tsx}"],
      rules: { "react-refresh/only-export-components": "off" },
    },
  ],
};

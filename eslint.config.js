import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// Matches #rgb, #rgba, #rrggbb and #rrggbbaa anywhere in a string.
const HEX_COLOUR = "#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![0-9a-zA-Z])";
const hexMessage =
  "Raw hex colours are not allowed in components; use a token from app/styles/tokens.css (CLAUDE.md, SPEC 7.4 rule 7).";

export default tseslint.config(
  {
    ignores: [
      "legacy/**",
      "build/**",
      ".react-router/**",
      ".wrangler/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "worker-configuration.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
    },
  },
  {
    files: ["app/components/**/*.{ts,tsx}", "app/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: `Literal[value=/${HEX_COLOUR}/]`, message: hexMessage },
        { selector: `TemplateElement[value.raw=/${HEX_COLOUR}/]`, message: hexMessage },
        { selector: `JSXText[value=/${HEX_COLOUR}/]`, message: hexMessage },
      ],
    },
  },
);

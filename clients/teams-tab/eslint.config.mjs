/**
 * The gate this package did not have.
 *
 * `clients/teams-tab` was the only client with no eslint config and no `lint`
 * script, and it is the largest and newest of them. Standalone `eslint .`
 * exited **2** — "couldn't find an eslint.config" — which a report that
 * counted error LINES read as zero errors.
 *
 * That is worse than a permanently-red package. Red still reports; absent
 * never did, and it produced a confident "eslint 0" in an enumerated gate
 * table written specifically to stop unfalsifiable claims. The counting
 * method is fixed too: exit codes, not greps for the word "error".
 *
 * Shaped after `clients/desktop`, which is the other React package here, so
 * the type-safety restrictions and the import boundary are the SAME rules
 * rather than a second opinion about them. Two client packages disagreeing
 * about what a type assertion may do is how a rule becomes a preference.
 *
 * `react-hooks` is included because this package's defects have been hook
 * defects — a `useEffect` writing state during render is exactly the shape of
 * the shell remount and the 40-second loading state, both found by looking at
 * a screen rather than by a tool.
 */
import {
  tseslint,
  globals,
  commonIgnores,
  linterOptionsConfig,
} from "../../eslint/flat-base.mjs";
import { traycerTypeSafetyRestrictions } from "../../eslint/traycer-type-safety-rules.mjs";
import { traycerClientsImportBoundaryRestrictions } from "../../eslint/traycer-clients-import-boundary-rules.mjs";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      ...commonIgnores,
      "dist/**",
      // The screenshot and probe harnesses are plain `.mjs` node scripts run
      // by hand, not shipped code. They are linted by nothing today and
      // pulling them in here would be a second change hiding inside this one.
      "tools/**",
      "vite.config.ts",
      "vitest.config.ts",
    ],
  },
  linterOptionsConfig,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
      // Browser, not node: this is a Teams tab. `globals.node` here would let
      // a `process.env` read pass lint and fail at runtime in the iframe.
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
    },
    rules: {
      "no-restricted-syntax": ["error", ...traycerTypeSafetyRestrictions],
      "@typescript-eslint/no-restricted-imports": [
        "error",
        traycerClientsImportBoundaryRestrictions,
      ],
      ...reactHooks.configs.recommended.rules,
    },
  },
);

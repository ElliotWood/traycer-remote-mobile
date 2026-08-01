import {
  tseslint,
  globals,
  commonIgnores,
  linterOptionsConfig,
} from "../../eslint/flat-base.mjs";
import { traycerTypeSafetyRestrictions } from "../../eslint/traycer-type-safety-rules.mjs";

// Deliberately NOT `traycerClientsImportBoundaryRestrictions` — that rule
// permits `@traycer/protocol/*` (correctly, for clients that speak the host
// wire protocol). This bot never should: it consumes the bridge's
// channel-agnostic action surface, never the host RPC protocol directly (see
// the epic brief's thin-adapter requirement, and rubric §4). So the ban here
// is total, not the narrower `_internal/` carve-out other clients get.
export default tseslint.config(
  { ignores: [...commonIgnores] },
  linterOptionsConfig,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node, ...globals.es2021 },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "no-restricted-syntax": ["error", ...traycerTypeSafetyRestrictions],
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@traycer/protocol",
                "@traycer/protocol/**",
                "@traycerai/**",
              ],
              message:
                "clients/teams-bot must hold zero Traycer protocol knowledge — it consumes " +
                "remote-bridge's channel-agnostic action surface, never the host RPC protocol " +
                "directly. If this import feels necessary, that belongs in remote-bridge instead.",
            },
          ],
        },
      ],
    },
  },
);

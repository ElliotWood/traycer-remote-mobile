import {
  tseslint,
  globals,
  commonIgnores,
  linterOptionsConfig,
} from "../../eslint/flat-base.mjs";
import { traycerTypeSafetyRestrictions } from "../../eslint/traycer-type-safety-rules.mjs";
import { traycerClientsImportBoundaryRestrictions } from "../../eslint/traycer-clients-import-boundary-rules.mjs";

export default tseslint.config(
  { ignores: [...commonIgnores, "dist-sea/**"] },
  linterOptionsConfig,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser, ...globals.es2021 },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "no-restricted-syntax": ["error", ...traycerTypeSafetyRestrictions],
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          ...traycerClientsImportBoundaryRestrictions,
          patterns: [
            ...traycerClientsImportBoundaryRestrictions.patterns,
            {
              // This package must not reach for ITSELF by its public alias.
              // The bun workspace symlinks `node_modules/@traycer-clients/shared`
              // at this directory, so the alias and the relative path resolve to
              // the same bytes and every tool is content — it compiles by
              // accident. It stops coinciding the moment `shared` is consumed as
              // a built artifact, and then it fails at a distance.
              //
              // The rule exists because the hazard is created by MOVING a file
              // in: an `@traycer-clients/shared/...` import that was correct in
              // `clients/mobile` becomes self-referential here, and nothing
              // objects. Tab-plan decision 6 ("extract on demand, never
              // duplicate") makes that a routine operation.
              group: [
                "@traycer-clients/shared",
                "@traycer-clients/shared/*",
                "@traycer-clients/shared/**",
              ],
              message:
                "clients/shared must not import itself by its public alias — use a relative path. " +
                "The alias resolves via the workspace symlink and so compiles by accident, " +
                "but it silently detaches from the file's real location the moment it moves.",
            },
          ],
        },
      ],
    },
  },
);

import {
  tseslint,
  globals,
  commonIgnores,
  linterOptionsConfig,
} from "../../eslint/flat-base.mjs";
import reactHooks from "eslint-plugin-react-hooks";
import {
  traycerTypeSafetyRestrictions,
  typeBypassRestrictions,
  optionalParameterRestrictions,
  requiredArgumentRestrictions,
  explicitTypeReferenceRestrictions,
} from "../../eslint/traycer-type-safety-rules.mjs";
import { traycerClientsImportBoundaryRestrictions } from "../../eslint/traycer-clients-import-boundary-rules.mjs";

// `typeBypassRestrictions` is [as-any ban, as-unknown ban, chained-assertion
// ban] — the "as any" ban is kept everywhere (zero hits today; nothing is
// being deferred for it). Only the other two get relaxed, and only for the
// test-fixture override below.
const [asAnyBan] = typeBypassRestrictions;

export default tseslint.config(
  {
    ignores: [
      ...commonIgnores,
      "vite.config.ts",
      "vite.tailnet.config.ts",
      "vitest.config.ts",
      "vitest.setup.ts",
    ],
  },
  linterOptionsConfig,
  reactHooks.configs.flat.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node, ...globals.es2021 },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "no-restricted-syntax": ["error", ...traycerTypeSafetyRestrictions],
      "@typescript-eslint/no-restricted-imports": [
        "error",
        traycerClientsImportBoundaryRestrictions,
      ],
    },
  },

  // ── Per-directory overrides ─────────────────────────────────────────────
  {
    // `src/host/**` is a hand-rolled subscription-hook layer (WebSocket
    // frames, RPC fetches) — every hook here resets/derives local state the
    // moment its dependency (a connection, id, or client) changes, THEN
    // subscribes or fetches. `react-hooks/set-state-in-effect` (the
    // React-Compiler-readiness tier) reads that as "reconcile during render
    // instead" — the advice that fixed the interview-crash bug this whole
    // gate exists downstream of, and the reason the rule is NOT dropped
    // package-wide (`src/views/**` keeps it live, where new components get
    // written). Every one of the 11 sites this exempts was individually
    // triaged (Evaluator review, mobile-lint-gate sprint) and is a
    // legitimate external-source sync, not a bug — see the sprint's
    // findings for the per-site breakdown. This override is the boundary
    // of that triage, not a blanket "hooks are exempt" carve-out.
    files: ["src/host/**/*.ts"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // Wire-protocol test fixtures (`chat.subscribe`/`epic.subscribe` frame
    // shapes) are large, versioned, discriminated-union types — hand
    // constructing one that fully satisfies the real type (every field,
    // every literal narrowed) is real, per-fixture work, demonstrated
    // achievable (gui-app's `terminal-session-store.test.ts` does exactly
    // this, zero casts) but not done here yet. 37 sites across the test
    // suite lean on `as unknown as X` / chained assertions instead —
    // an established convention (predates this gate; `chat-view.test.tsx`
    // already did this before mobile had a lint config at all), deferred
    // deliberately as VISIBLE debt, not fixed silently and not exempted
    // package-wide: `ReturnType`, default-params, and optional-params stay
    // enforced here too, and this override does not apply to `src/`
    // production code (see the mobile-lint-gate sprint's follow-up ticket
    // for the typed-builder rewrite).
    files: ["**/__tests__/**/*.{ts,tsx}", "src/test-utils/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        asAnyBan,
        ...optionalParameterRestrictions,
        ...requiredArgumentRestrictions,
        ...explicitTypeReferenceRestrictions,
      ],
    },
  },
);

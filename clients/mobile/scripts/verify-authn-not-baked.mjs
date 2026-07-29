#!/usr/bin/env node
// Postbuild gate (config incident, 2026-07-28): when `VITE_AUTHN_BASE_URL`
// is supplied at build time, Vite statically substitutes
// `import.meta.env.VITE_AUTHN_BASE_URL` and dead-code-eliminates the
// now-unreachable `"https://authn.traycer.ai"` fallback branch in
// `config.ts`. This script proves that actually happened: the raw
// production authn hostname must not appear ANYWHERE in the built JS —
// if it does, the fallback survived, and every sign-in attempt on a
// non-production origin will die to a CORS block (authn's allowlist is
// exactly one origin: https://platform.traycer.ai).
//
// When `VITE_AUTHN_BASE_URL` is NOT supplied (a plain local/default build),
// the fallback branch is legitimate and this check is a no-op — that
// configuration is exactly what `app-root.tsx`'s `ConfigErrorScreen`
// (via `config-diagnostics.ts`) exists to catch honestly at runtime instead.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const assetsDir = resolve(scriptDir, "..", "dist", "assets");

const configuredAuthnBase = process.env.VITE_AUTHN_BASE_URL;
if (configuredAuthnBase === undefined || configuredAuthnBase.length === 0) {
  console.log(
    "[verify-authn-not-baked] VITE_AUTHN_BASE_URL was not set for this build — skipping (the fallback is expected and handled at runtime by app-root.tsx's config gate).",
  );
  process.exit(0);
}

const NEEDLE = "authn.traycer.ai";
const offenders = [];

for (const file of readdirSync(assetsDir)) {
  if (!file.endsWith(".js")) continue;
  const contents = readFileSync(join(assetsDir, file), "utf8");
  if (contents.includes(NEEDLE)) {
    offenders.push(file);
  }
}

if (offenders.length > 0) {
  console.error(
    `[verify-authn-not-baked] "${NEEDLE}" appears in the built bundle even though VITE_AUTHN_BASE_URL was set — the production authn fallback was NOT tree-shaken:\n` +
      offenders.map((file) => `  - dist/assets/${file}`).join("\n") +
      `\n\nThis is a CORS trap: any sign-in call this build makes to the raw production authn origin will be blocked from any origin other than https://platform.traycer.ai.`,
  );
  process.exit(1);
}

console.log(
  `[verify-authn-not-baked] OK — "${NEEDLE}" does not appear in the built bundle; the production authn fallback was tree-shaken as expected.`,
);

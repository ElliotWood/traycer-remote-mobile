#!/usr/bin/env node
// Postbuild gate (staleness incident, 2026-07-28): asserts every
// entry-critical asset referenced by the built index.html (its module
// script, modulepreload links, and stylesheet) actually appears in the
// generated service worker's precache manifest. `vite.config.ts`'s
// `manifestTransforms` already derives this at build time — this is a
// deliberately INDEPENDENT re-check of the two build outputs against each
// other, so a regression in that transform (or a future rewrite of it)
// can't silently reopen the same gap without failing the build.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// `fileURLToPath` + `dirname` rather than `import.meta.dirname` — this runs
// under both `node` and `bun` (the build is invoked as `bun run build`), and
// only the former is guaranteed to have the newer field.
const scriptDir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(scriptDir, "..", "dist");
const indexHtml = readFileSync(resolve(distDir, "index.html"), "utf8");
const swSource = readFileSync(resolve(distDir, "sw.js"), "utf8");

function extractAttr(tag, attr) {
  const match = new RegExp(`\\s${attr}="([^"]*)"`).exec(tag);
  return match !== null ? match[1] : null;
}

function collectEntryCriticalUrls(html) {
  const urls = new Set();
  for (const tagMatch of html.matchAll(/<script\b[^>]*>/g)) {
    const tag = tagMatch[0];
    if (extractAttr(tag, "type") === "module") {
      const src = extractAttr(tag, "src");
      if (src !== null) urls.add(src);
    }
  }
  for (const tagMatch of html.matchAll(/<link\b[^>]*>/g)) {
    const tag = tagMatch[0];
    const rel = extractAttr(tag, "rel");
    if (rel === "modulepreload" || rel === "stylesheet") {
      const href = extractAttr(tag, "href");
      if (href !== null) urls.add(href);
    }
  }
  return [...urls].map((url) => url.replace(/^\//, ""));
}

const required = collectEntryCriticalUrls(indexHtml);
const precached = new Set(
  [...swSource.matchAll(/"url":"([^"]+)"/g)].map((match) => match[1]),
);

const missing = required.filter((url) => !precached.has(url));

if (missing.length > 0) {
  console.error(
    `[verify-precache-manifest] ${missing.length} entry-critical asset(s) referenced by dist/index.html are NOT in the service worker's precache manifest:\n` +
      missing.map((url) => `  - ${url}`).join("\n") +
      `\n\nThis is the exact class of bug that shipped a stale-chunk regression (2026-07-28). Check vite.config.ts's injectManifest.manifestTransforms.`,
  );
  process.exit(1);
}

console.log(
  `[verify-precache-manifest] OK — all ${required.length} entry-critical asset(s) are precached.`,
);

import { describe, expect, it } from "vitest";
import { collectEntryCriticalUrls } from "../collect-entry-critical-urls";

// Fixture shaped exactly like the real built `dist/index.html` at the time
// of the staleness incident (2026-07-28): an entry module script, two
// modulepreload chunks, one stylesheet, plus a PWA manifest link (not
// entry-critical — must NOT be picked up) and a non-module inline script.
const SAMPLE_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <link rel="icon" type="image/png" href="/icons/icon-192.png" />
    <script type="module" crossorigin src="/assets/index-Dp6M0tyU.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/rolldown-runtime-QTnfLwEv.js">
    <link rel="modulepreload" crossorigin href="/assets/kind-tokens-DEi-uw6u.js">
    <link rel="stylesheet" crossorigin href="/assets/index-TNY2vPDE.css">
    <link rel="manifest" href="/manifest.webmanifest">
  </head>
  <body>
    <div id="root"></div>
    <script>window.__inline = true;</script>
  </body>
</html>`;

describe("collectEntryCriticalUrls", () => {
  it("collects the module entry script, modulepreload chunks, and stylesheet", () => {
    expect(collectEntryCriticalUrls(SAMPLE_INDEX_HTML).sort()).toEqual(
      [
        "assets/index-Dp6M0tyU.js",
        "assets/rolldown-runtime-QTnfLwEv.js",
        "assets/kind-tokens-DEi-uw6u.js",
        "assets/index-TNY2vPDE.css",
      ].sort(),
    );
  });

  it("excludes the manifest link and non-module inline scripts", () => {
    const urls = collectEntryCriticalUrls(SAMPLE_INDEX_HTML);
    expect(urls).not.toContain("manifest.webmanifest");
    expect(urls).not.toContain("/manifest.webmanifest");
  });

  it("strips the leading slash so urls match workbox's relative manifest keys", () => {
    const urls = collectEntryCriticalUrls(SAMPLE_INDEX_HTML);
    for (const url of urls) {
      expect(url.startsWith("/")).toBe(false);
    }
  });

  it("returns an empty list for html with no boot-critical assets", () => {
    expect(collectEntryCriticalUrls("<html><body>hi</body></html>")).toEqual([]);
  });

  it("is order-independent across script/link attributes", () => {
    const reordered = `<script src="/assets/entry.js" crossorigin type="module"></script>`;
    expect(collectEntryCriticalUrls(reordered)).toEqual(["assets/entry.js"]);
  });
});

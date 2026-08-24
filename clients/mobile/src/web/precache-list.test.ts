import { describe, expect, it } from "vitest";
import { collectEntryCriticalUrls } from "./precache-list";

const PAGE = "https://host.example/next/index.html";

/** Shaped like a real Vite emission at `base: "/next/"`. */
const BUILT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Traycer</title>
    <script type="module" crossorigin src="/next/assets/index-ltCjhZBG.js"></script>
    <link rel="modulepreload" crossorigin href="/next/assets/rolldown-runtime-BQq1lVzy.js">
    <link rel="stylesheet" crossorigin href="/next/assets/index-DrTf9dPw.css">
    <link rel="manifest" href="/next/manifest.webmanifest">
    <link rel="apple-touch-icon" href="/next/icons/apple-touch-icon.png">
  </head>
  <body><div id="root"></div></body>
</html>`;

describe("collectEntryCriticalUrls", () => {
  it("collects the entry script, its preloads, the stylesheet and the manifest", () => {
    // Whole-list assertion rather than a set of `toContain`s. A `toContain`
    // per known URL passes on a list that ALSO swept in something it should
    // not have - and over-precaching is the failure that costs megabytes on
    // install, so it has to be assertable.
    expect(collectEntryCriticalUrls(BUILT_HTML, PAGE)).toEqual([
      "/next/assets/index-ltCjhZBG.js",
      "/next/assets/rolldown-runtime-BQq1lVzy.js",
      "/next/assets/index-DrTf9dPw.css",
      "/next/manifest.webmanifest",
    ]);
  });

  it("finds a preloaded chunk no name pattern would have predicted", () => {
    // THE ORIGINAL DEFECT, as a test. The archived build listed
    // `assets/index-*.js` by hand; `rolldown-runtime-*` and `kind-tokens-*`
    // fell outside it and shipped un-precached even though the precached
    // index.html cannot boot without them. Nothing here matches on a name.
    const html = `<script type="module" src="/next/assets/index-a.js"></script>
      <link rel="modulepreload" href="/next/assets/kind-tokens-Zz9.js">
      <link rel="modulepreload" href="/next/assets/wholly-unexpected-Qq1.js">`;

    expect(collectEntryCriticalUrls(html, PAGE)).toEqual([
      "/next/assets/index-a.js",
      "/next/assets/kind-tokens-Zz9.js",
      "/next/assets/wholly-unexpected-Qq1.js",
    ]);
  });

  it("resolves relative hrefs against the page, not against the origin root", () => {
    // The `/next/` half of this. The archived collector stripped a leading
    // slash, which is only equivalent to resolution when the app is served
    // from `/`. Under `base: "/next/"` stripping yields `next/assets/...`,
    // which the worker would resolve relative to its own directory and
    // precache as `/next/next/assets/...` - a 404, and `addAll` is atomic, so
    // the entire precache fails and the app has no offline support at all.
    const html = `<script type="module" src="./assets/index-a.js"></script>
      <link rel="stylesheet" href="assets/index-b.css">`;

    expect(collectEntryCriticalUrls(html, PAGE)).toEqual([
      "/next/assets/index-a.js",
      "/next/assets/index-b.css",
    ]);
  });

  it("drops cross-origin assets rather than failing the whole precache", () => {
    const html = `<script type="module" src="/next/assets/index-a.js"></script>
      <link rel="stylesheet" href="https://cdn.example/font.css">`;

    expect(collectEntryCriticalUrls(html, PAGE)).toEqual([
      "/next/assets/index-a.js",
    ]);
  });

  it("ignores non-module scripts and unrelated link rels", () => {
    // An inline analytics `<script>` has no `src`; a `prefetch` is by
    // definition not boot-critical. Precaching either would be wrong in a
    // different way from missing one, and only one of the two is loud.
    const html = `<script>window.x=1</script>
      <script src="/next/legacy.js"></script>
      <script type="module" src="/next/assets/index-a.js"></script>
      <link rel="prefetch" href="/next/assets/lazy-mermaid.js">
      <link rel="icon" href="/next/favicon.ico">`;

    expect(collectEntryCriticalUrls(html, PAGE)).toEqual([
      "/next/assets/index-a.js",
    ]);
  });

  it("de-duplicates a URL named twice", () => {
    const html = `<script type="module" src="/next/a.js"></script>
      <link rel="modulepreload" href="/next/a.js">`;

    expect(collectEntryCriticalUrls(html, PAGE)).toEqual(["/next/a.js"]);
  });

  it("returns nothing for HTML with no tags it recognises", () => {
    // Paired with the assertions above so an empty result is a MEASURED
    // outcome rather than the thing every other test would also produce if
    // the regexes silently stopped matching. `build-sw.mjs` refuses to write
    // a worker on a list this short, which is the other half of this guard.
    expect(
      collectEntryCriticalUrls("<html><body>hi</body></html>", PAGE),
    ).toEqual([]);
  });
});

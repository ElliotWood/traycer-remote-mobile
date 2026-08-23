/**
 * Which URLs the service worker precaches, derived from the BUILT `index.html`.
 *
 * Ported from the retired `clients/mobile/vite/collect-entry-critical-urls.ts`,
 * which existed because of a staleness incident (2026-07-28): the precache list
 * was a hand-maintained glob list (`assets/index-*.js`, ...), and every time the
 * bundler split a new shared chunk under a different name (`rolldown-runtime-*`,
 * `kind-tokens-*`) that chunk fell outside every pattern and shipped
 * un-precached - even though the precached `index.html` needs it to boot, as a
 * `<link rel=modulepreload>` rather than a `<script src>`. The CSS bundle was
 * missing the same way.
 *
 * This repo has since recorded the general form of that trap: a chunk-name glob
 * matched three chunks and reported the opposite of the truth. So the list is
 * never named - it is read out of the one document that structurally has to be
 * right, the entry HTML the browser itself boots from.
 *
 * TWO DELIBERATE DIFFERENCES FROM THE ARCHIVED VERSION:
 *
 * 1. It takes the page URL and resolves against it, instead of stripping a
 *    leading `/`. The archived build was served at `/`, where "strip the slash"
 *    and "resolve against the base" agree. This bundle is served at `/next/`,
 *    where they do not: stripping would yield `next/assets/index-x.js`, a path
 *    that resolves relative to the service worker's own directory and would
 *    have precached `/next/next/assets/...` - four 404s at install, and
 *    `cache.addAll` rejects as a unit, so the WHOLE precache would fail.
 *
 * 2. It returns absolute same-origin PATHS, because the service worker matches
 *    them against `new URL(request.url).pathname`. A relative URL cannot be
 *    compared to a request.
 */

/** Reads one double-quoted attribute off a single tag. */
function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return match !== null ? match[1] : null;
}

/**
 * The boot-critical URLs named by `html`, as origin-absolute paths.
 *
 * `pageUrl` is the absolute URL the HTML is served from (e.g.
 * `https://host/next/index.html`); every href is resolved against it, so both
 * absolute (`/next/assets/x.js`) and relative (`./assets/x.js`) emissions land
 * on the same answer.
 *
 * Order is preserved and duplicates removed, so the result reads like the
 * document.
 */
export function collectEntryCriticalUrls(
  html: string,
  pageUrl: string,
): string[] {
  const urls = new Set<string>();

  const add = (href: string | null): void => {
    if (href === null || href.length === 0) return;
    let resolved: URL;
    try {
      resolved = new URL(href, pageUrl);
    } catch {
      return;
    }
    // Cross-origin preloads (a CDN font, say) are not ours to precache: the
    // response would be opaque, `cache.addAll` would reject on it, and taking
    // the whole precache down for an optional asset is the wrong trade.
    if (resolved.origin !== new URL(pageUrl).origin) return;
    urls.add(resolved.pathname);
  };

  for (const match of html.matchAll(/<script\b[^>]*>/g)) {
    const tag = match[0];
    if (attribute(tag, "type") === "module") add(attribute(tag, "src"));
  }

  for (const match of html.matchAll(/<link\b[^>]*>/g)) {
    const tag = match[0];
    const rel = attribute(tag, "rel");
    if (rel === "modulepreload" || rel === "stylesheet" || rel === "manifest") {
      add(attribute(tag, "href"));
    }
  }

  return [...urls];
}

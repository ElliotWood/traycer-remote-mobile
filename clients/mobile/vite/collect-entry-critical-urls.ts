/**
 * Staleness incident (2026-07-28): `injectManifest`'s `globPatterns` glob-
 * matches dist file NAMES against a hand-maintained list (`assets/index-*.js`,
 * …) — every time the bundler splits a new shared/vendor chunk under a
 * different name (this repo: `rolldown-runtime-*`, `kind-tokens-*`), that
 * chunk falls outside every pattern and ships un-precached even though the
 * precached `index.html` needs it to boot (as a `<link rel=modulepreload>`,
 * not even a `<script src>`). The CSS bundle was missing the same way.
 *
 * Parses the BUILT `index.html`'s own `<script type=module src>`,
 * `<link rel=modulepreload>`, and `<link rel=stylesheet>` tags — the actual,
 * structural boot-critical dependency list — so nothing has to be
 * hand-maintained or kept in sync with the bundler's chunk-naming choices.
 */
export function collectEntryCriticalUrls(html: string): string[] {
  const urls = new Set<string>();

  const extractAttr = (tag: string, attr: string): string | null => {
    const match = new RegExp(`\\s${attr}="([^"]*)"`).exec(tag);
    return match !== null ? match[1] : null;
  };

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

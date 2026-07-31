/**
 * MOVED from `clients/mobile/src/views/markdown` when the Teams tab needed
 * the same rendering. CSS colour parsing for theming a diagram.
 *
 * Framework-agnostic — no React, no client config — which is why it moves
 * whole. The BLOCK COMPONENTS do not: they take mobile's `colors`, so each
 * client keeps its own thin component over this shared runtime rather than
 * inheriting another client's palette.
 *
 * Vendored from `clients/gui-app/src/lib/css-color.ts` (pure DOM + culori
 * logic, no desktop imports — mobile does not import across the client
 * boundary, see `use-create-chat.ts`'s docblock). Simplified to a single
 * `document` (mobile has no multi-window/iframe editor scenario gui-app's
 * version threads a `Document` param for).
 *
 * U3 fix: `mermaid-runtime.ts` used to hand mermaid the RAW `"var(--background)"`
 * string from `views/ui.ts`'s `colors.*` (a CSS custom-property reference,
 * not a color). Mermaid v11's `Theme.calculate` does real color math
 * (darken/lighten for borders, contrast for labels) on these values — a
 * `var()` string isn't a parseable color, so that math silently produced
 * broken/invisible output (the reported dark-on-dark / invisible-SVG
 * regression). `resolveCssColor` reads the ACTUAL cascade-resolved value via
 * `getComputedStyle` and normalizes it to `rgb(...)` first.
 */
import { formatRgb, parse } from "culori";

const SAFE_BLACK = "rgb(0, 0, 0)";

/**
 * Convert any CSS color expression (`oklch()`, hex, `rgb()`, `hsl()`, named)
 * to an `rgb(...)` string — the format consumers painting outside the
 * Tailwind cascade (Mermaid) reliably parse.
 */
export function rgbify(value: string): string {
  if (value.length === 0) return SAFE_BLACK;
  if (/^(rgb|#)/i.test(value)) return value;
  const parsed = parse(value);
  if (parsed === undefined) return SAFE_BLACK;
  const formatted = formatRgb(parsed);
  return formatted.length > 0 ? formatted : SAFE_BLACK;
}

/** Read a CSS custom property as the cascade resolves it right now. */
export function readCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Resolve a CSS custom property to an `rgb(...)` string, falling back to
 * `fallback` (itself any CSS color literal) when the variable is unset on
 * the active cascade — e.g. a jsdom test with no real stylesheet applied.
 */
export function resolveCssColor(name: string, fallback: string): string {
  const raw = readCssVar(name);
  return rgbify(raw.length > 0 ? raw : fallback);
}

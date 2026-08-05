/**
 * Shared inline styles for the phone client (T4).
 *
 * The app is a small glance-and-triage surface, so its handful of screens share
 * a dark, single-column phone layout defined here rather than pulling in a CSS
 * framework. Inline `CSSProperties` keeps each view self-contained and avoids a
 * global stylesheet build step.
 *
 * Tailwind-foundation pivot: `colors.*` now reference the SAME live CSS custom
 * properties `design-tokens.tsx`'s `theme.*` does (`global.css`'s
 * `.dark[data-theme="traycer-green"]` block), rather than the pre-pivot
 * hand-picked hex (`#111`/`#4a9eff` shell blue/etc.) — every one of this
 * module's ~20 content-screen call sites (chat blocks, artifact body,
 * comments, markdown/mermaid/wireframe, sign-in) picks up the real desktop
 * palette with zero changes at the call site. Field NAMES are unchanged on
 * purpose (`bg`/`text`/`muted`/`accent`/...) so this is a pure repoint, not a
 * rename.
 */
import type { CSSProperties } from "react";

export const colors = {
  bg: "var(--background)",
  text: "var(--foreground)",
  muted: "var(--muted-foreground)",
  border: "var(--border)",
  accent: "var(--primary)",
  danger: "var(--destructive)",
  dangerBg: "color-mix(in oklch, var(--destructive) 12%, transparent)",
} as const;

export const screen: CSSProperties = {
  fontFamily:
    "'Figtree Variable', Figtree, ui-sans-serif, system-ui, -apple-system, sans-serif",
  maxWidth: 480,
  margin: "0 auto",
  // `100dvh`, not `100vh` — plain `100vh` overshoots the visible viewport on
  // mobile browsers, causing the page to scroll behind the app's
  // fixed-height layout. See `global.css`'s `body` rule / `design-tokens.tsx`'s
  // `screen` token for the same fix.
  minHeight: "100dvh",
  boxSizing: "border-box",
  padding: 16,
  background: colors.bg,
  color: colors.text,
};

export const primaryButton: CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  fontSize: 16,
  border: 0,
  borderRadius: 8,
  background: colors.accent,
  color: "var(--primary-foreground)",
  cursor: "pointer",
};

export const secondaryButton: CSSProperties = {
  padding: "8px 14px",
  fontSize: 14,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  background: "transparent",
  color: colors.text,
  cursor: "pointer",
};

export const row: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  padding: 12,
  marginBottom: 8,
  background: "transparent",
  color: colors.text,
  cursor: "pointer",
};

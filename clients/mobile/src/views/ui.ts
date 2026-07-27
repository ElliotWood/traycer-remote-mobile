/**
 * Shared inline styles for the phone client (T4).
 *
 * The app is a small glance-and-triage surface, so its handful of screens share
 * a dark, single-column phone layout defined here rather than pulling in a CSS
 * framework. Inline `CSSProperties` keeps each view self-contained and avoids a
 * global stylesheet build step.
 */
import type { CSSProperties } from "react";

export const colors = {
  bg: "#111",
  text: "#eee",
  muted: "#888",
  border: "#333",
  accent: "#4a9eff",
  danger: "#e5484d",
  dangerBg: "#2a1414",
} as const;

export const screen: CSSProperties = {
  fontFamily: "system-ui, sans-serif",
  maxWidth: 480,
  margin: "0 auto",
  minHeight: "100vh",
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
  color: "#fff",
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

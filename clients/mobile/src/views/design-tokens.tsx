/**
 * Desktop-ported design tokens + primitives (Sprint 6, round 1).
 *
 * Values are the REAL computed sRGB hex for gui-app's actual default theme —
 * `DEFAULT_THEME_PRESET = "traycer-green"` (`lib/theme-presets.ts`), dark mode
 * — not the plain `:root`/`.dark` base tokens in `index.css` (those are an
 * inert neutral-gray fallback no real install shows). The two OKLCH-defined
 * values in the `traycer-green` dark block (`--success`, and the unmodified
 * `--destructive`/`--warning` inherited from the base `.dark` block) were
 * converted to sRGB hex via `culori` — the same color library gui-app itself
 * uses — for bit-accurate values, not eyeballed.
 *
 * Scope: applied to Fleet + Epic-detail only this round (Sprint 6 contract).
 * `views/ui.ts`'s original tokens stay byte-identical so chat/artifact/
 * comments screens are unaffected until the rest of the app migrates here.
 */
import type { CSSProperties, ReactElement, ReactNode } from "react";

export const theme = {
  background: "#121715",
  surface: "#1a2421",
  text: "#ffffff",
  // Row/list-item title color — the desktop convention is foreground at
  // ~75% opacity, not flat 100% white (Evaluator round-1 finding).
  textRow: "rgba(255, 255, 255, 0.87)",
  mutedText: "#a8a8a8",
  border: "#33433d",
  borderHairline: "rgba(255, 255, 255, 0.1)",
  primary: "#257174",
  primaryForeground: "#ffffff",
  danger: "#ff6467",
  dangerSurface: "rgba(255, 100, 103, 0.12)",
  success: "#6eba66",
  warning: "#e6ac3d",
} as const;

/** `--radius: 0.375rem` base — 6px (buttons) → 8px (rows) → 10px (elevated cards), rising with elevation. */
export const radius = {
  sm: 4,
  md: 6,
  row: 8,
  lg: 10,
  xl: 13,
} as const;

/** `index.css`'s `@theme inline` text scale, px-converted. Titles are MEDIUM weight (500) — desktop's `CardTitle` is `font-medium`, not semibold. */
export const type = {
  titleLg: { fontSize: 30, lineHeight: "36px", fontWeight: 600 } as CSSProperties,
  titleMd: { fontSize: 20, lineHeight: "26px", fontWeight: 600 } as CSSProperties,
  titleSm: { fontSize: 16, lineHeight: "24px", fontWeight: 500 } as CSSProperties,
  body: { fontSize: 16, lineHeight: "24px" } as CSSProperties,
  bodySm: { fontSize: 14, lineHeight: "20px" } as CSSProperties,
  bodyXs: { fontSize: 12, lineHeight: "16px" } as CSSProperties,
} as const;

export const screen: CSSProperties = {
  fontFamily:
    "'Figtree Variable', Figtree, ui-sans-serif, system-ui, -apple-system, sans-serif",
  maxWidth: 480,
  margin: "0 auto",
  minHeight: "100vh",
  boxSizing: "border-box",
  padding: 16,
  background: theme.background,
  color: theme.text,
};

const MIN_TOUCH = 44;

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "destructive";

const BUTTON_VARIANT_STYLE: Readonly<Record<ButtonVariant, CSSProperties>> = {
  primary: { background: theme.primary, color: theme.primaryForeground, border: "1px solid transparent" },
  secondary: { background: theme.surface, color: theme.text, border: "1px solid transparent" },
  ghost: { background: "transparent", color: theme.text, border: "1px solid transparent" },
  outline: { background: "transparent", color: theme.text, border: `1px solid ${theme.border}` },
  destructive: { background: theme.dangerSurface, color: theme.danger, border: "1px solid transparent" },
};

export interface ButtonProps {
  readonly variant?: ButtonVariant;
  readonly children: ReactNode;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  readonly fullWidth?: boolean;
  readonly type?: "button" | "submit";
}

/** Desktop's button language (`components/ui/button.tsx`), touch-sized (≥44px — desktop's 32-36px targets are mouse-sized). */
export function Button({
  variant = "primary",
  children,
  onClick,
  disabled = false,
  fullWidth = false,
  type = "button",
}: ButtonProps): ReactElement {
  const variantStyle = BUTTON_VARIANT_STYLE[variant];
  const style: CSSProperties = {
    ...variantStyle,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: MIN_TOUCH,
    width: fullWidth ? "100%" : undefined,
    padding: "0 16px",
    borderRadius: radius.md,
    fontSize: 15,
    fontWeight: 500,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
    whiteSpace: "nowrap",
  };
  return (
    <button type={type} style={style} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export interface CardProps {
  readonly children: ReactNode;
  readonly onClick?: () => void;
  /** A status accent — renders as a LEFT edge only, never replaces the neutral hairline border on the other 3 sides. */
  readonly accentColor?: string;
}

/**
 * Desktop's card surface (`components/ui/card.tsx`): a LIGHTER surface than
 * the page background (elevation) + a neutral hairline ring — never a flat
 * same-color box with a hard 1px line. `accentColor` (status coloring) only
 * ever tints the LEFT edge, mirroring S1's `KindCard` convention — it never
 * recolors the whole border.
 */
export function Card({ children, onClick, accentColor }: CardProps): ReactElement {
  const style: CSSProperties = {
    display: "block",
    width: "100%",
    textAlign: "left",
    background: theme.surface,
    border: `1px solid ${theme.borderHairline}`,
    borderLeft: accentColor ? `3px solid ${accentColor}` : `1px solid ${theme.borderHairline}`,
    borderRadius: radius.lg,
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.24)",
    padding: 12,
    marginBottom: 8,
    minHeight: onClick ? MIN_TOUCH : undefined,
    cursor: onClick ? "pointer" : undefined,
    color: theme.text,
  };
  if (onClick) {
    return (
      <button type="button" style={style} onClick={onClick}>
        {children}
      </button>
    );
  }
  return <div style={style}>{children}</div>;
}

export function SectionHeading({ children }: { readonly children: ReactNode }): ReactElement {
  return <h1 style={{ ...type.titleMd, margin: 0, color: theme.text }}>{children}</h1>;
}

/**
 * Semantic color for a freeform epic/status string — the same idiom the
 * desktop uses for status language, since an EPIC isn't kind-typed like an
 * artifact (spec/ticket/story/review colors don't apply here).
 */
export function statusToneColor(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("block")) return theme.danger;
  if (s.includes("done") || s.includes("complete")) return theme.success;
  if (s.includes("progress") || s.includes("review")) return theme.warning;
  return theme.mutedText;
}

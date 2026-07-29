/**
 * Design tokens + primitives (Sprint 6 → P1/P2 → Tailwind-foundation pivot).
 *
 * `theme.*` now reference the LIVE CSS custom properties `global.css` sets
 * under `.dark[data-theme="traycer-green"]` (hardcoded on `<html>` —
 * `index.html`) rather than hand-copied hex — every screen using `theme.*`
 * in an inline style picks up the exact same resolved values Tailwind
 * utility classes do, with zero per-screen changes. `Button`/`Card` now
 * DELEGATE to the vendored shadcn primitives (`@/components/ui/button`,
 * `@/components/ui/card` — copied verbatim from gui-app) so every existing
 * call site gets the real desktop button/card markup for free; the touch
 * bump (`min-h-11` ≈ 44px) layers on top via `cn()`, since desktop's own
 * `h-8`/`h-9` targets are mouse-sized (Sprint 6 finding, still valid).
 */
import type { VariantProps } from "class-variance-authority";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { Button as ShadButton, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ShadButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;

/** The vendored `Card`'s own base classes (`@/components/ui/card.tsx`) — duplicated here since that component has no `asChild` escape hatch for the clickable-row case below. */
const CARD_BASE_CLASSES =
  "group/card flex flex-col gap-4 overflow-hidden rounded-xl bg-card py-4 text-ui-sm text-card-foreground ring-1 ring-foreground/10 has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0";

export const theme = {
  background: "var(--background)",
  surface: "var(--card)",
  text: "var(--foreground)",
  // Row/list-item title color — the desktop convention is foreground at
  // ~75% opacity, not flat 100% white (Evaluator round-1 finding).
  textRow: "color-mix(in oklch, var(--foreground) 87%, transparent)",
  mutedText: "var(--muted-foreground)",
  border: "var(--border)",
  borderHairline: "color-mix(in oklch, var(--foreground) 10%, transparent)",
  primary: "var(--primary)",
  primaryForeground: "var(--primary-foreground)",
  danger: "var(--destructive)",
  dangerSurface: "color-mix(in oklch, var(--destructive) 12%, transparent)",
  success: "var(--success)",
  warning: "var(--warning)",
} as const;

/** `--radius: 0.375rem` base — 6px (buttons) → 8px (rows) → 10px (elevated cards), rising with elevation. Mirrors `global.css`'s `@theme inline` radius scale. */
export const radius = {
  sm: 4,
  md: 6,
  row: 8,
  lg: 10,
  xl: 13,
} as const;

/** `global.css`'s `@theme inline` text scale, px-converted. Titles are MEDIUM weight (500) — desktop's `CardTitle` is `font-medium`, not semibold. */
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
  // `100dvh`, not `100vh` — plain `100vh` overshoots the visible viewport on
  // mobile browsers (it's sized with the URL bar collapsed), causing the
  // page to scroll behind the app's fixed-height layout. Unlike a stylesheet
  // rule, an inline style object can't express a fallback-then-override
  // cascade for one property, so this only sets the modern value — matches
  // `#root`'s existing `min-height: 100dvh` in global.css, which also has no
  // `vh` fallback.
  minHeight: "100dvh",
  boxSizing: "border-box",
  padding: 16,
  background: theme.background,
  color: theme.text,
};

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "destructive";

const VARIANT_TO_SHAD: Readonly<Record<ButtonVariant, ShadButtonVariant>> = {
  primary: "default",
  secondary: "secondary",
  ghost: "ghost",
  outline: "outline",
  destructive: "destructive",
};

export interface ButtonProps {
  readonly variant?: ButtonVariant;
  readonly children: ReactNode;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  readonly fullWidth?: boolean;
  readonly type?: "button" | "submit";
}

/** Thin wrapper over the vendored shadcn `Button` — real desktop classes, bumped to a ≥44px touch target (`min-h-11`) since desktop's own sizes are mouse-sized. */
export function Button({
  variant = "primary",
  children,
  onClick,
  disabled = false,
  fullWidth = false,
  type = "button",
}: ButtonProps): ReactElement {
  return (
    <ShadButton
      type={type}
      variant={VARIANT_TO_SHAD[variant]}
      disabled={disabled}
      onClick={onClick}
      className={cn("min-h-11 px-4 text-[15px]", fullWidth && "w-full")}
    >
      {children}
    </ShadButton>
  );
}

export interface CardProps {
  readonly children: ReactNode;
  readonly onClick?: () => void;
  /** A status accent — renders as a LEFT edge only, never replaces the neutral hairline ring on the other 3 sides. */
  readonly accentColor?: string;
}

/**
 * Thin wrapper over the vendored shadcn `Card` classes (real `rounded-xl
 * ring-1 ring-foreground/10` desktop surface, not a hand-rolled border).
 * `accentColor` (status coloring) only ever tints the LEFT edge, mirroring
 * S1's `KindCard` convention — it never recolors the whole ring. Renders a
 * real `<button>` (not `<div onClick>`) when tappable, for correct
 * semantics/keyboard support — `@/components/ui/card`'s `Card` has no
 * `asChild` escape hatch, so the clickable variant applies the same base
 * classes directly rather than nesting a button inside a div.
 */
export function Card({ children, onClick, accentColor }: CardProps): ReactElement {
  const style: CSSProperties = accentColor ? { borderLeft: `3px solid ${accentColor}` } : {};
  const className = cn(CARD_BASE_CLASSES, "mb-2 gap-2 px-4 py-3 text-left", onClick && "min-h-11 w-full cursor-pointer");
  if (onClick) {
    return (
      <button type="button" data-slot="card" style={style} className={className} onClick={onClick}>
        {children}
      </button>
    );
  }
  return (
    <div data-slot="card" style={style} className={className}>
      {children}
    </div>
  );
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

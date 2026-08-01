/**
 * The boundary the tab did not have.
 *
 * `clients/teams-tab` contained zero `ErrorBoundary` / `componentDidCatch` /
 * `getDerivedStateFromError`, so **any render throw anywhere produced an empty
 * `<div id="root">` and nothing else** — the same blank-tab symptom the
 * storage `SecurityError` produced, arriving through a different door. That
 * fix closed the *cause*; the *class* stayed open.
 *
 * `clients/mobile` has had one since 2026-07-28 (`views/error-boundary.tsx`),
 * at the app root and per-route. This is that pattern, with the two
 * differences the Teams surface forces.
 *
 * ## Difference 1 — the fallback renders PLAIN DOM, never Fluent
 *
 * A `FluentProvider` or theme throw is one of the failures this must survive,
 * and a fallback built from `@fluentui/react-components` would be taken down
 * by the very error it is trying to report — a boundary that works except
 * when it is needed most.
 *
 * That is a property of the MODULE GRAPH, not a promise in a comment: this
 * file imports nothing but `react`. Theming still happens, because Fluent
 * publishes its tokens as CSS custom properties and a `var()` reference needs
 * no import. Each carries a literal fallback for the case where no provider
 * ever mounted, which is precisely the case where this boundary is the only
 * thing on screen.
 *
 * The var NAMES are written out rather than imported, so drift is the risk
 * that replaces the import. `__tests__/error-boundary.test.tsx` pins each one
 * against the real `tokens` export, so a Fluent rename turns a test red
 * instead of silently falling back to the literal.
 *
 * ## Difference 2 — the error text is SHOWN, not only logged
 *
 * Mobile logs to `console.error` and shows generic copy, which is right in a
 * browser with devtools one keystroke away. Inside Teams there is no address
 * bar and no easy console — the same reasoning that made the config screen
 * name its missing variables instead of just saying "not configured". A blank
 * tab with a message beats a blank tab, and the message is the whole
 * difference between "it broke" and a report someone can act on.
 */
import { Component, type ErrorInfo, type ReactElement, type ReactNode } from "react";

/**
 * Fluent v9 emits every design token as a CSS custom property of the same
 * name, so `var(--colorNeutralForeground1)` is the token WITHOUT importing the
 * library. The second argument is the value used when no `FluentProvider` is
 * mounted above this element — the last-resort position, where one may well
 * have thrown on the way up.
 */
const COLOR = {
  text: "var(--colorNeutralForeground1, #242424)",
  subtle: "var(--colorNeutralForeground3, #616161)",
  background: "var(--colorNeutralBackground1, #ffffff)",
  dangerBorder: "var(--colorPaletteRedBorder2, #d13438)",
  dangerText: "var(--colorPaletteRedForeground1, #b10e1c)",
} as const;

/** The token names above, unwrapped — pinned against Fluent's own export in the tests. */
export const FALLBACK_TOKEN_NAMES = [
  "colorNeutralForeground1",
  "colorNeutralForeground3",
  "colorNeutralBackground1",
  "colorPaletteRedBorder2",
  "colorPaletteRedForeground1",
] as const;

export interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /**
   * Short phrase naming what failed, e.g. "Traycer", "this screen". Read into
   * the fallback copy and the console line.
   */
  readonly label?: string;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

/**
 * React supports error boundaries only as class components — no hook
 * equivalent exists, which is why this is the one class in the package.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Still logged as well as shown. The visible copy is for whoever is
    // looking at the tab; this is for whoever attaches a debugger to it, and
    // it carries the component stack, which the fallback deliberately does
    // not.
    console.error("[teams-tab]", this.props.label ?? "", error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return <ErrorFallback error={error} label={this.props.label} onReset={this.reset} />;
  }
}

function buttonStyle(emphasis: "primary" | "subtle"): Record<string, string | number> {
  return {
    minHeight: 32,
    padding: "0 12px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: emphasis === "primary" ? COLOR.dangerBorder : COLOR.subtle,
    borderRadius: 4,
    background: "transparent",
    color: emphasis === "primary" ? COLOR.dangerText : COLOR.subtle,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  };
}

function ErrorFallback({
  error,
  label,
  onReset,
}: {
  readonly error: Error;
  readonly label: string | undefined;
  readonly onReset: () => void;
}): ReactElement {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        margin: 16,
        padding: 16,
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: COLOR.dangerBorder,
        borderRadius: 6,
        background: COLOR.background,
        color: COLOR.text,
        fontFamily:
          "var(--fontFamilyBase, 'Segoe UI', system-ui, -apple-system, sans-serif)",
      }}
    >
      <strong style={{ fontSize: 14 }}>
        {label === undefined
          ? "Something went wrong."
          : `Something went wrong in ${label}.`}
      </strong>
      {/*
        THE MESSAGE, verbatim. `word-break` because a stack-shaped message or a
        long URL would otherwise widen the frame past the iframe and take the
        buttons off screen with it — the fallback becoming a second layout
        defect is not a theoretical worry at 380px.
      */}
      <span
        style={{
          fontSize: 12,
          color: COLOR.subtle,
          fontFamily: "var(--fontFamilyMonospace, ui-monospace, monospace)",
          overflowWrap: "anywhere",
          maxHeight: 160,
          overflowY: "auto",
        }}
      >
        {error.message}
      </span>
      <div style={{ display: "flex", gap: 8 }}>
        {/*
          RETRY re-renders the subtree; RELOAD re-fetches the app. Both are
          offered because they fail differently: retry is free and fixes a
          transient throw, and is useless against a bad module or a stale
          bundle — where reload is the only way out, and there is no address
          bar in Teams to do it from.
        */}
        <button type="button" onClick={onReset} style={buttonStyle("primary")}>
          Retry
        </button>
        <button
          type="button"
          onClick={() => {
            window.location.reload();
          }}
          style={buttonStyle("subtle")}
        >
          Reload
        </button>
      </div>
    </div>
  );
}

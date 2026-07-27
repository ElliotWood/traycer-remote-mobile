/**
 * A single component throwing anywhere in the tree used to take out the
 * WHOLE app (a bare white screen, no way back) — there was no error
 * boundary anywhere. React only supports error boundaries as class
 * components (no hook equivalent exists); this is a small, reusable one
 * used at a few granularities: `AppRoot` (last resort), each top-level
 * screen (fleet/epic tree/chat/artifact), and around individual transcript
 * block cards so one malformed block can't kill the whole transcript.
 */
import { Component, type ErrorInfo, type ReactElement, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { radius, theme, type } from "./design-tokens";

export interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /** Short label for the fallback copy, e.g. "this chat", "this block" — defaults to a generic phrase. */
  readonly label?: string;
  /** Compact renders a small inline fallback (for a single block card) instead of a full-screen one. */
  readonly compact?: boolean;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", this.props.label ?? "", error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <ErrorFallback label={this.props.label} compact={this.props.compact} onReset={this.reset} />
    );
  }
}

function ErrorFallback({
  label,
  compact,
  onReset,
}: {
  readonly label: string | undefined;
  readonly compact: boolean | undefined;
  readonly onReset: () => void;
}): ReactElement {
  const message = `Something went wrong${label ? ` in ${label}` : ""}.`;
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: compact ? 10 : 16,
        margin: compact ? "0 0 8px" : 16,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: theme.danger,
        background: theme.dangerSurface,
        color: theme.text,
      }}
    >
      <span style={{ ...type.bodySm, flex: 1 }}>{message}</span>
      <button
        type="button"
        onClick={onReset}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          minHeight: compact ? 32 : 40,
          padding: "0 10px",
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: theme.danger,
          borderRadius: radius.md,
          background: "transparent",
          color: theme.danger,
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        <RotateCcw size={13} aria-hidden="true" />
        Retry
      </button>
    </div>
  );
}

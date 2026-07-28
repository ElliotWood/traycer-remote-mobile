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
import { RefreshCw, RotateCcw } from "lucide-react";
import { radius, theme, type } from "./design-tokens";

/**
 * Staleness incident (2026-07-28): a lazy route (`ChatView`/`ArtifactRouteView`,
 * B2-2) that 404s or MIME-mismatches after a deploy throws from inside
 * `React.lazy`'s promise rejection — the SAME generic "Something went wrong"
 * fallback below would show, and its Retry button re-renders the SAME
 * `lazy()` component, which replays the SAME cached-rejected import()
 * promise forever. A stale chunk isn't a transient error a re-render can
 * fix; it needs a fresh navigation to pick up the new build. Browsers phrase
 * this failure differently, hence the multiple patterns.
 */
function isChunkLoadError(error: Error): boolean {
  const message = error.message;
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /Failed to load module script/i.test(message) ||
    /dynamically imported module/i.test(message)
  );
}

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
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (isChunkLoadError(error)) {
      return <ChunkLoadErrorFallback compact={this.props.compact} />;
    }
    return (
      <ErrorFallback label={this.props.label} compact={this.props.compact} onReset={this.reset} />
    );
  }
}

function ChunkLoadErrorFallback({ compact }: { readonly compact: boolean | undefined }): ReactElement {
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
        borderColor: theme.primary,
        background: theme.surface,
        color: theme.text,
      }}
    >
      <span style={{ ...type.bodySm, flex: 1 }}>
        A new version is available — reload to continue.
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          minHeight: compact ? 32 : 40,
          padding: "0 10px",
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: theme.primary,
          borderRadius: radius.md,
          background: "transparent",
          color: theme.primary,
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        <RefreshCw size={13} aria-hidden="true" />
        Reload
      </button>
    </div>
  );
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

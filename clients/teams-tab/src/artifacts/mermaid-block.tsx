/**
 * A ```mermaid fence, rendered to SVG over the shared runtime.
 *
 * A PARSE FAILURE SHOWS THE SOURCE, NEVER A BLANK. Agent-authored diagrams
 * are sometimes malformed, and the honest result is a named failure with the
 * text that failed — the sixteen-chips rule in a different medium: an
 * incomplete view beats a misleading one, and a gap you can see beats a gap
 * you cannot.
 *
 * Showing the SOURCE as well as the message is the part worth stating: a
 * reader who can see the diagram text can tell whether the agent wrote
 * nonsense or we failed to render something reasonable. A bare "couldn't
 * render" makes those two indistinguishable.
 */
import { useEffect, useState, type ReactElement } from "react";
import { Caption1, makeStyles, tokens } from "@fluentui/react-components";
import {
  deriveMermaidErrorMessage,
  renderMermaidSvg,
} from "@traycer-clients/shared/browser/mermaid-runtime";

type State =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly svg: string }
  | { readonly status: "error"; readonly message: string };

const useStyles = makeStyles({
  diagram: {
    overflowX: "auto",
    padding: tokens.spacingVerticalS,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  failed: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingVerticalS,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  why: { color: tokens.colorPaletteDarkOrangeForeground1 },
  source: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    color: tokens.colorNeutralForeground3,
  },
  loading: { color: tokens.colorNeutralForeground3 },
});

export function MermaidBlock({ code }: { code: string }): ReactElement {
  const styles = useStyles();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    renderMermaidSvg(code).then(
      (svg) => {
        if (!cancelled) setState({ status: "ready", svg });
      },
      (err: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: deriveMermaidErrorMessage(err),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (state.status === "loading") {
    return <Caption1 className={styles.loading}>Rendering diagram…</Caption1>;
  }
  if (state.status === "error") {
    return (
      <div className={styles.failed} role="status">
        <Caption1 className={styles.why}>
          Couldn’t render this diagram: {state.message}
        </Caption1>
        {/* The source, so a reader can tell a bad diagram from a bad render. */}
        <Caption1 className={styles.source}>{code}</Caption1>
      </div>
    );
  }
  return (
    <div
      className={styles.diagram}
      // The runtime returns mermaid's own sanitised SVG (`securityLevel:
      // "strict"`); this is the only way to mount it.
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
}

/**
 * Renders a ` ```mermaid ` fence to an SVG diagram, lazily. Never throws past
 * this component — a parse/render failure shows a labeled inline error
 * instead (contract M2 / rubric §4: no silent data loss, no thrown error).
 */
import { useEffect, useState, type ReactElement } from "react";
import { colors } from "../ui";
import { deriveMermaidErrorMessage, renderMermaidSvg } from "./mermaid-runtime";

type MermaidState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly svg: string }
  | { readonly status: "error"; readonly message: string };

export interface MermaidBlockProps {
  readonly code: string;
}

export function MermaidBlock({ code }: MermaidBlockProps): ReactElement {
  const [state, setState] = useState<MermaidState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    renderMermaidSvg(code).then(
      (svg) => {
        if (!cancelled) setState({ status: "ready", svg });
      },
      (err: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: deriveMermaidErrorMessage(err) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (state.status === "loading") {
    return (
      <div
        data-testid="mermaid-loading"
        style={{ color: colors.muted, fontSize: 13, padding: "8px 0" }}
      >
        Rendering diagram…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        role="alert"
        data-testid="mermaid-error"
        style={{
          color: colors.danger,
          background: colors.dangerBg,
          border: `1px solid ${colors.danger}`,
          borderRadius: 8,
          padding: 10,
          fontSize: 13,
        }}
      >
        Diagram error: {state.message}
      </div>
    );
  }

  // Mermaid's own `securityLevel: "strict"` sanitizes the diagram output
  // (no script/foreignObject handlers survive); the SVG string is trusted
  // the same way the desktop editor treats it.
  return (
    <div
      data-testid="mermaid-diagram"
      style={{ maxWidth: "100%", overflowX: "auto" }}
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
}

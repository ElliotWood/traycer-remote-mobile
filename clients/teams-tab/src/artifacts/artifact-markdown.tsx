/**
 * Artifact bodies, rendered as real markdown.
 *
 * THIS IS THE SURFACE THE PIVOT WAS JUSTIFIED ON. The bot's cards could not
 * render tables, headings, code fences or blockquotes — Teams card markdown
 * supports none of them — so an artifact arrived as flattened prose with its
 * structure removed. Here the structure survives, because a tab is a real web
 * view.
 *
 * `rehype-sanitize` is NOT optional. Artifact bodies are agent-authored and
 * arrive over the wire; rendering them unsanitised would make any agent that
 * writes a `<script>` tag an XSS vector against the signed-in user. The
 * sanitiser runs on the ONE path that renders this content, so there is no
 * second route to keep in sync.
 *
 * Two fences are intercepted rather than rendered as code: ` ```mermaid `
 * becomes a diagram and ` ```wireframe ` becomes a sandboxed preview. Every
 * other fence stays a fence — including an unrecognised one, which renders as
 * its own source rather than disappearing.
 */
import type { ReactElement, ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { makeStyles, tokens } from "@fluentui/react-components";
import { MermaidBlock } from "./mermaid-block";
import { WireframeBlock } from "./wireframe-block";

const useStyles = makeStyles({
  body: {
    // Every element below is themed by token, never by a literal colour —
    // high contrast replaces the palette wholesale and a hardcoded hex
    // survives it, which is how a "styled" body becomes unreadable there.
    color: tokens.colorNeutralForeground1,
    lineHeight: tokens.lineHeightBase300,
    "& h1, & h2, & h3, & h4": {
      marginTop: tokens.spacingVerticalL,
      marginBottom: tokens.spacingVerticalXS,
      lineHeight: tokens.lineHeightBase400,
    },
    "& p": { marginTop: 0, marginBottom: tokens.spacingVerticalM },
    "& ul, & ol": { paddingLeft: tokens.spacingHorizontalXXL },
    "& li": { marginBottom: tokens.spacingVerticalXS },
    "& blockquote": {
      margin: 0,
      paddingLeft: tokens.spacingHorizontalM,
      borderLeft: `3px solid ${tokens.colorNeutralStroke2}`,
      color: tokens.colorNeutralForeground3,
    },
    "& code": {
      fontFamily: tokens.fontFamilyMonospace,
      backgroundColor: tokens.colorNeutralBackground3,
      padding: "1px 4px",
      borderRadius: tokens.borderRadiusSmall,
    },
    "& pre": {
      // A code fence SCROLLS rather than wrapping: wrapping reflows code and
      // changes what it appears to say. Same reasoning as `pre-wrap` in the
      // transcript, opposite mechanism.
      overflowX: "auto",
      padding: tokens.spacingVerticalS,
      borderRadius: tokens.borderRadiusMedium,
      backgroundColor: tokens.colorNeutralBackground3,
    },
    "& pre code": { backgroundColor: "transparent", padding: 0 },
    "& table": {
      // The thing the card surface could not do at all.
      borderCollapse: "collapse",
      display: "block",
      overflowX: "auto",
      maxWidth: "100%",
    },
    "& th, & td": {
      border: `1px solid ${tokens.colorNeutralStroke2}`,
      padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
      textAlign: "left",
    },
    "& th": { backgroundColor: tokens.colorNeutralBackground3 },
    "& a": { color: tokens.colorBrandForegroundLink },
    "& img": { maxWidth: "100%" },
    "& hr": {
      border: "none",
      borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
  },
});

function fenceLanguage(className: unknown): string | null {
  if (typeof className !== "string") return null;
  const match = /language-([\w-]+)/.exec(className);
  return match?.[1] ?? null;
}

function textOf(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(textOf).join("");
  return "";
}

export function ArtifactMarkdown({ body }: { body: string }): ReactElement {
  const styles = useStyles();
  return (
    <div className={styles.body}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          code({ className, children, ...rest }) {
            const language = fenceLanguage(className);
            const source = textOf(children).replace(/\n$/, "");
            if (language === "mermaid") return <MermaidBlock code={source} />;
            if (language === "wireframe")
              return <WireframeBlock code={source} />;
            // Everything else, including an unrecognised language, stays a
            // fence. A fence we do not understand renders as its own source —
            // never as nothing.
            return (
              <code className={className} {...rest}>
                {children}
              </code>
            );
          },
        }}
      >
        {body}
      </Markdown>
    </div>
  );
}

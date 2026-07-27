/**
 * Shared markdown renderer (Mobile v2, Sprint 1 / M2) — used by chat text
 * blocks (Sprint 2) and artifact bodies (Sprint 3), mirroring
 * `clients/gui-app/src/markdown/traycer-markdown.tsx` scoped to what those
 * sprints need: no inline reference chips (`@chat`/`@spec`/…) — not shipped
 * until content carrying them exists.
 *
 * Plugin order is load-bearing: `rehypeRaw` (parses raw HTML embedded in
 * markdown into the tree) MUST run BEFORE `rehypeSanitize` (strips anything
 * dangerous). Reversed, raw HTML would bypass sanitization — an XSS hole.
 */
import {
  isValidElement,
  type CSSProperties,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { PluggableList } from "unified";
import { colors } from "../ui";
import { MermaidBlock } from "./mermaid-block";
import { WireframeBlock } from "./wireframe-block";

const REMARK_PLUGINS: PluggableList = [remarkGfm];
// Raw HTML parsing first, sanitize LAST — see module docblock.
const REHYPE_PLUGINS: PluggableList = [rehypeRaw, [rehypeSanitize, defaultSchema]];

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return extractText(props.children);
  }
  return "";
}

const codeBlockStyle: CSSProperties = {
  overflowX: "auto",
  maxWidth: "100%",
  margin: "8px 0",
  padding: "8px 10px",
  borderRadius: 8,
  border: `1px solid ${colors.border}`,
  background: "#1a1a1a",
};

const inlineCodeStyle: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  fontSize: 13,
  background: "#1a1a1a",
  borderRadius: 4,
  padding: "1px 5px",
};

function CodeRenderer(props: ComponentPropsWithoutRef<"code">): ReactElement {
  const { className, children } = props;
  const language = /language-(\S+)/.exec(className ?? "")?.[1] ?? "";
  const code = extractText(children);
  const isInline = !className && !code.includes("\n");

  if (isInline) {
    return <code style={inlineCodeStyle}>{children}</code>;
  }
  if (language === "mermaid") return <MermaidBlock code={code} />;
  if (language === "wireframe") return <WireframeBlock code={code} />;

  return (
    <div style={codeBlockStyle}>
      <pre style={{ margin: 0 }}>
        <code
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            fontSize: 13,
            whiteSpace: "pre",
          }}
        >
          {code}
        </code>
      </pre>
    </div>
  );
}

// `CodeRenderer` renders its own container (a `<div>`/`<pre>`), so `pre`
// itself becomes a passthrough — mirrors the desktop `PreBlock` pattern.
function PreRenderer(props: ComponentPropsWithoutRef<"pre">): ReactElement {
  return <>{props.children}</>;
}

function TableRenderer(props: ComponentPropsWithoutRef<"table">): ReactElement {
  return (
    <div style={{ overflowX: "auto", maxWidth: "100%", margin: "8px 0" }}>
      <table {...props} style={{ borderCollapse: "collapse", minWidth: "100%" }} />
    </div>
  );
}

function ThRenderer(props: ComponentPropsWithoutRef<"th">): ReactElement {
  return (
    <th
      {...props}
      style={{
        border: `1px solid ${colors.border}`,
        padding: "6px 8px",
        textAlign: "left",
        whiteSpace: "nowrap",
      }}
    />
  );
}

function TdRenderer(props: ComponentPropsWithoutRef<"td">): ReactElement {
  return <td {...props} style={{ border: `1px solid ${colors.border}`, padding: "6px 8px" }} />;
}

function BlockquoteRenderer(props: ComponentPropsWithoutRef<"blockquote">): ReactElement {
  return (
    <blockquote
      {...props}
      style={{
        margin: "8px 0",
        padding: "2px 12px",
        borderLeft: `3px solid ${colors.border}`,
        color: colors.muted,
      }}
    />
  );
}

function AnchorRenderer(props: ComponentPropsWithoutRef<"a">): ReactElement {
  return <a {...props} style={{ color: colors.accent }} target="_blank" rel="noreferrer" />;
}

const COMPONENTS: Components = {
  a: AnchorRenderer,
  blockquote: BlockquoteRenderer,
  code: CodeRenderer,
  pre: PreRenderer,
  table: TableRenderer,
  td: TdRenderer,
  th: ThRenderer,
};

export interface MobileMarkdownProps {
  readonly children: string;
}

export function MobileMarkdown({ children }: MobileMarkdownProps): ReactElement {
  return (
    <div
      data-testid="mobile-markdown"
      style={{
        color: colors.text,
        fontSize: 15,
        lineHeight: 1.5,
        maxWidth: "100%",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
      }}
    >
      <Markdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={COMPONENTS}>
        {children}
      </Markdown>
    </div>
  );
}

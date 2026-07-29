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
  memo,
  useState,
  type CSSProperties,
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { PluggableList } from "unified";
import { deriveArtifactPathLayoutRootAgnostic } from "@traycer/protocol/common/artifact-path";
import { useHostClientOrNull } from "@/host/host-client-context";
import { useArtifactNav } from "@/host/artifact-nav-context";
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
  background: "var(--muted)",
};

const inlineCodeStyle: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  fontSize: 13,
  background: "var(--muted)",
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

/** A real `http(s)://` URL that ISN'T structurally an artifact link — a genuine external page. */
const EXTERNAL_URL_PATTERN = /^https?:\/\//i;
/** Protocol handoffs (mail client / dialer), not a page navigation — safe to leave as native anchor behavior. */
const PASSTHROUGH_SCHEME_PATTERN = /^(mailto|tel):/i;

const anchorLinkStyle: CSSProperties = { color: colors.accent };
const notFoundHintStyle: CSSProperties = { fontSize: 11, color: colors.muted, marginLeft: 4 };

/**
 * U1 fix: an artifact reference authored by an agent (a plain markdown link
 * to its on-disk `…/epics/<epicId>/artifacts/<chain>/index.md` path — desktop
 * resolves the SAME shape via `epic.resolveArtifactByPath`, see
 * `clients/gui-app/src/components/chat/build-chat-link-policy.ts`) must open
 * the artifact IN-APP, never as a real `<a href>` navigation — that reboots
 * the whole SPA, drops the nav stack, and re-pays the epic doc's decode cost.
 *
 * Only the structurally artifact-shaped case is handled here (an absolute-ish
 * path already ending in `index.md` under an `epics/<id>/artifacts/` marker,
 * root-agnostic — matches what agents actually emit into chat/artifact
 * markdown). A RELATIVE href authored from within an artifact's own folder
 * position (desktop's `resolveArtifactRelativeLinkPath`) is NOT rewritten —
 * mobile's artifact projection doesn't carry the artifact's own folder chain
 * to resolve it against, so that shape still falls through to the safe
 * external/no-op branches below rather than a real navigation. Flagged
 * simplification, not a silent gap: it degrades safely, it just doesn't
 * resolve.
 */
function AnchorRenderer(props: ComponentPropsWithoutRef<"a">): ReactElement {
  const { href, children, style: _ignoredStyle, target: _ignoredTarget, ...rest } = props;
  const client = useHostClientOrNull();
  const { openArtifact } = useArtifactNav();
  const [notFound, setNotFound] = useState(false);

  if (href === undefined || href.length === 0 || href.startsWith("#") || PASSTHROUGH_SCHEME_PATTERN.test(href)) {
    // Empty/fragment/protocol-handoff hrefs never risk an SPA reload — leave native.
    return (
      <a {...rest} href={href} style={anchorLinkStyle}>
        {children}
      </a>
    );
  }

  const artifactLayout = deriveArtifactPathLayoutRootAgnostic(href, null);
  if (artifactLayout !== null) {
    const handleArtifactClick = (event: MouseEvent<HTMLAnchorElement>): void => {
      event.preventDefault();
      if (client === null) return;
      client
        .request("epic.resolveArtifactByPath", { epicId: artifactLayout.epicId, filePath: href })
        .then((response) => {
          if (response.artifact !== null) {
            openArtifact(artifactLayout.epicId, response.artifact.artifactId);
          } else {
            setNotFound(true);
          }
        })
        .catch(() => setNotFound(true));
    };
    return (
      <a {...rest} href={href} onClick={handleArtifactClick} style={{ ...anchorLinkStyle, cursor: "pointer" }}>
        {children}
        {notFound && <span style={notFoundHintStyle}>(couldn't open that artifact)</span>}
      </a>
    );
  }

  if (EXTERNAL_URL_PATTERN.test(href)) {
    // A genuine external page — the ONE case that still opens a new tab.
    return (
      <a {...rest} href={href} target="_blank" rel="noopener noreferrer" style={anchorLinkStyle}>
        {children}
      </a>
    );
  }

  // Internal-shaped (relative/absolute path) but not artifact-resolvable —
  // mobile has no workspace-file browser to open it into, so the safe
  // behavior is a no-op, never a real navigation that reboots the SPA.
  const handleNoOpClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
  };
  return (
    <a {...rest} href={href} onClick={handleNoOpClick} style={anchorLinkStyle}>
      {children}
    </a>
  );
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

/**
 * Perf batch 2 (B2-3): memoized — the transcript's `TextBlock`/`ReasoningBlock`/etc.
 * pass a stable `children: string` once their own props are stable, so this bails
 * out instead of re-running `react-markdown`'s full parse+render on every re-render.
 * `COMPONENTS` above stays module-scope (not recreated here) — `AnchorRenderer`
 * calls hooks, so it must stay a plain component reference, not a per-render object.
 */
export const MobileMarkdown = memo(function MobileMarkdown({ children }: MobileMarkdownProps): ReactElement {
  return (
    <div
      data-testid="mobile-markdown"
      className="prose dark:prose-invert md-prose prose-sm max-w-none"
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
});

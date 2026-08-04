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
 *
 * LINKS ARE INTERCEPTED TOO, and that is not cosmetic. This component is this
 * package's UNIVERSAL prose renderer — nine call sites, most of them chat
 * transcript blocks — so every link an agent writes anywhere in the tab comes
 * through here. Until `AnchorRenderer` below, every one of them rendered as a
 * bare `<a href>` with no `target`, which in a Teams personal tab navigates
 * the IFRAME THE APP IS. There is no address bar and no back button in that
 * frame, so the only recovery is re-selecting the tab. Mobile fixed the same
 * defect on a surface where it merely rebooted the SPA; see
 * `clients/mobile/src/views/markdown/mobile-markdown.tsx` and its U1 note.
 */
import { useState, type ComponentPropsWithoutRef, type MouseEvent, type ReactElement, type ReactNode } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { makeStyles, tokens } from "@fluentui/react-components";
import { deriveArtifactPathLayoutRootAgnostic } from "@traycer/protocol/common/artifact-path";
import { useArtifactLink } from "./artifact-link-context";
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

/** A real `http(s)://` URL — a genuine external page, not an in-app reference. */
const EXTERNAL_URL_PATTERN = /^https?:\/\//i;
/** Protocol handoffs (mail client / dialer). Not a page navigation, so safe to leave native. */
const PASSTHROUGH_SCHEME_PATTERN = /^(mailto|tel):/i;

/**
 * The link policy. Four branches, and EVERY ONE of them is here so that no
 * click navigates the tab's iframe away from the app.
 *
 * | href shape | what happens |
 * | --- | --- |
 * | empty · `#fragment` · `mailto:`/`tel:` | left native — none of these load a page |
 * | `…/epics/<id>/artifacts/<chain>/index.md` | resolved via `epic.resolveArtifactByPath` and opened IN-APP |
 * | `https://…` | `target="_blank"` + `rel="noopener noreferrer"` — the one case that leaves, and it leaves in a NEW tab |
 * | anything else internal-shaped | `preventDefault`, no-op |
 *
 * The external branch is the one most likely to fire in practice — agents
 * paste ordinary web links into chat constantly — and it is the one whose
 * absence was most costly, because without `target` it replaces the app with
 * the linked page inside Teams' own frame.
 *
 * The last branch looks like the least important and is not: a relative href
 * such as `src/foo.ts` would resolve against the tab's base path, hit the SPA
 * fallback, and `parseRoute` would return `epics` — so the click would land
 * the reader silently on the epic LIST. Route parsing already records that
 * unknown paths fall back rather than 404, which is right for a stale link and
 * wrong as the result of pressing something.
 *
 * Only the structurally artifact-shaped path is resolved, matching mobile: a
 * relative link authored from inside an artifact's own folder needs that
 * artifact's folder chain to resolve against, which this projection does not
 * carry. That shape falls through to the no-op branch — it degrades safely, it
 * just does not resolve. Flagged rather than silent.
 */
function AnchorRenderer(props: ComponentPropsWithoutRef<"a">): ReactElement {
  const { href, children, target: _ignoredTarget, ...rest } = props;
  const { resolveArtifact, openArtifact } = useArtifactLink();
  const [failed, setFailed] = useState(false);

  if (
    href === undefined ||
    href.length === 0 ||
    href.startsWith("#") ||
    PASSTHROUGH_SCHEME_PATTERN.test(href)
  ) {
    return (
      <a {...rest} href={href}>
        {children}
      </a>
    );
  }

  const layout = deriveArtifactPathLayoutRootAgnostic(href, null);
  if (layout !== null) {
    const onArtifactClick = (event: MouseEvent<HTMLAnchorElement>): void => {
      event.preventDefault();
      resolveArtifact(layout.epicId, href)
        .then((artifactId) => {
          // Two different failures, deliberately collapsed into one message
          // for the reader and kept apart here: the host resolved nothing, or
          // it resolved something this screen cannot open (a foreign epic).
          // Neither may fall through to a navigation.
          if (artifactId === null || !openArtifact(layout.epicId, artifactId)) {
            setFailed(true);
          }
        })
        .catch(() => {
          setFailed(true);
        });
    };
    return (
      <a {...rest} href={href} onClick={onArtifactClick}>
        {children}
        {failed ? <span> (couldn&apos;t open that artifact)</span> : null}
      </a>
    );
  }

  if (EXTERNAL_URL_PATTERN.test(href)) {
    return (
      <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }

  const onNoOpClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
  };
  return (
    <a {...rest} href={href} onClick={onNoOpClick}>
      {children}
    </a>
  );
}

/**
 * MODULE SCOPE, not an object literal in the render body, and this is
 * load-bearing rather than a micro-optimisation. `AnchorRenderer` calls hooks;
 * a map rebuilt every render gives react-markdown a new component identity
 * every time, so every anchor remounts on each render and `failed` — the state
 * that carries the "couldn't open that artifact" message — is discarded before
 * the reader sees it. Mobile's renderer records the same constraint.
 */
const COMPONENTS: Components = {
  a: AnchorRenderer,
  code({ className, children, ...rest }) {
    const language = fenceLanguage(className);
    const source = textOf(children).replace(/\n$/, "");
    if (language === "mermaid") return <MermaidBlock code={source} />;
    if (language === "wireframe") return <WireframeBlock code={source} />;
    // Everything else, including an unrecognised language, stays a fence. A
    // fence we do not understand renders as its own source — never as nothing.
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  },
};

export function ArtifactMarkdown({ body }: { body: string }): ReactElement {
  const styles = useStyles();
  return (
    <div className={styles.body}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={COMPONENTS}
      >
        {body}
      </Markdown>
    </div>
  );
}

/**
 * Read-only renderer for the Tiptap/ProseMirror `JsonContent` payload the
 * comment RPCs carry (S4, F4). Mirrors gui-app's
 * `comment-content-renderer.tsx` grammar exactly, so a comment authored on
 * desktop and one authored here render identically:
 *
 *   block:  paragraph, bulletList, orderedList, listItem
 *   inline: text (marks: bold/italic/code/strike), mention, hardBreak
 *
 * A node outside that vocabulary but carrying `content` recurses into its
 * children (never silently drops text); a childless unknown leaf falls back
 * to its own `text` field, or renders nothing. Never throws.
 */
import { Fragment, type CSSProperties, type ReactNode } from "react";
import type { JsonContent } from "@traycer/protocol/common/registry";
import { colors } from "../ui";

export interface CommentContentProps {
  readonly content: JsonContent;
}

export function CommentContent({ content }: CommentContentProps): ReactNode {
  return (
    <div data-testid="comment-content" style={rootStyle}>
      <CommentNodeList nodes={content.content ?? []} />
    </div>
  );
}

function CommentNodeList({
  nodes,
}: {
  readonly nodes: readonly JsonContent[];
}): ReactNode {
  return (
    <>
      {nodes.map((node, position) => (
        <Fragment key={nodeKey(node, position)}>
          <CommentNode node={node} />
        </Fragment>
      ))}
    </>
  );
}

function nodeKey(node: JsonContent, position: number): string {
  const type = typeof node.type === "string" ? node.type : "unknown";
  return `${type}#${position.toString()}`;
}

function CommentNode({ node }: { readonly node: JsonContent }): ReactNode {
  const block = renderBlock(node);
  if (block !== undefined) return block;
  if (node.type === "mention") return renderMention(node);
  if (node.type === "text") return renderText(node);
  // Unknown node - render its children as a fallback so a future schema
  // addition (e.g. blockquote) still surfaces text instead of vanishing.
  if (node.content !== undefined) return <CommentNodeList nodes={node.content} />;
  return node.text ?? null;
}

function renderBlock(node: JsonContent): ReactNode | undefined {
  switch (node.type) {
    case "paragraph":
      return (
        <p style={paragraphStyle}>
          <CommentNodeList nodes={node.content ?? []} />
        </p>
      );
    case "bulletList":
      return (
        <ul style={bulletListStyle}>
          <CommentNodeList nodes={node.content ?? []} />
        </ul>
      );
    case "orderedList":
      return (
        <ol style={orderedListStyle}>
          <CommentNodeList nodes={node.content ?? []} />
        </ol>
      );
    case "listItem":
      return (
        <li>
          <CommentNodeList nodes={node.content ?? []} />
        </li>
      );
    case "hardBreak":
      return <br />;
    default:
      return undefined;
  }
}

function renderMention(node: JsonContent): ReactNode {
  const attrs = node.attrs ?? {};
  const label = typeof attrs.label === "string" ? attrs.label : null;
  const id = typeof attrs.id === "string" ? attrs.id : null;
  const display = label !== null && label.length > 0 ? label : (id ?? "");
  return <span style={mentionStyle}>@{display}</span>;
}

function renderText(node: JsonContent): ReactNode {
  const text = node.text ?? "";
  if (node.marks === undefined || node.marks.length === 0) return text;
  return node.marks.reduce<ReactNode>((acc, mark) => {
    switch (mark.type) {
      case "bold":
        return <strong>{acc}</strong>;
      case "italic":
        return <em>{acc}</em>;
      case "code":
        return <code style={codeStyle}>{acc}</code>;
      case "strike":
        return <s>{acc}</s>;
      default:
        return acc;
    }
  }, text);
}

const rootStyle: CSSProperties = {
  fontSize: 14,
  lineHeight: 1.5,
  color: colors.text,
  overflowWrap: "anywhere",
};

const paragraphStyle: CSSProperties = { margin: "4px 0" };
const bulletListStyle: CSSProperties = { margin: "4px 0", paddingLeft: 20, listStyleType: "disc" };
const orderedListStyle: CSSProperties = { margin: "4px 0", paddingLeft: 20, listStyleType: "decimal" };
const mentionStyle: CSSProperties = { color: colors.accent, fontWeight: 600 };
const codeStyle: CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  fontSize: 13,
  background: colors.border,
  borderRadius: 4,
  padding: "1px 4px",
};

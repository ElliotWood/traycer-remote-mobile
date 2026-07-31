/**
 * Read-only renderer for the `JsonContent` the comment RPCs carry.
 *
 * The GRAMMAR is shared (`@traycer-clients/shared/epic/comment-content`); this
 * is the Fluent-token rendering of it. Third arrival at the same seam —
 * protocol shared, palette per-client — after the artifact status integers and
 * the mermaid runtime. Treating it as the rule now rather than rediscovering
 * it a fourth time.
 *
 * The vocabulary, matching gui-app and mobile so a comment authored anywhere
 * reads the same:
 *
 *   block:  paragraph, bulletList, orderedList, listItem
 *   inline: text (marks bold/italic/code/strike), mention, hardBreak
 *
 * AN UNKNOWN NODE RECURSES INTO ITS CHILDREN rather than being skipped, and a
 * childless unknown leaf falls back to its own `text`. So a node kind this
 * renderer has never seen loses its FORMATTING and never its WORDS.
 *
 * That matters more here than anywhere else this rule has been applied: a
 * dropped chip omits something an agent did; a dropped node silently shortens
 * something a PERSON said, and neither they nor the reader would know.
 */
import { Fragment, type ReactElement, type ReactNode } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import type { JsonContent } from "@traycer/protocol/common/registry";

const useStyles = makeStyles({
  p: { margin: 0, marginBottom: tokens.spacingVerticalXS },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalXXL },
  code: {
    fontFamily: tokens.fontFamilyMonospace,
    backgroundColor: tokens.colorNeutralBackground3,
    padding: "1px 4px",
    borderRadius: tokens.borderRadiusSmall,
  },
  mention: { color: tokens.colorBrandForegroundLink },
});

interface Node {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly content?: unknown;
  readonly marks?: unknown;
  readonly attrs?: unknown;
}

function marksOf(node: Node): readonly string[] {
  if (!Array.isArray(node.marks)) return [];
  return node.marks.flatMap((m) => {
    if (typeof m !== "object" || m === null) return [];
    const type = (m as { type?: unknown }).type;
    return typeof type === "string" ? [type] : [];
  });
}

function withMarks(text: string, marks: readonly string[], key: string, codeClass: string): ReactNode {
  let node: ReactNode = text;
  // Applied innermost-out so nesting order does not change the result.
  if (marks.includes("code")) node = <code className={codeClass}>{node}</code>;
  if (marks.includes("strike")) node = <s>{node}</s>;
  if (marks.includes("italic")) node = <em>{node}</em>;
  if (marks.includes("bold")) node = <strong>{node}</strong>;
  return <Fragment key={key}>{node}</Fragment>;
}

export function CommentContent({
  content,
}: {
  content: JsonContent;
}): ReactElement {
  const styles = useStyles();

  const render = (raw: unknown, key: string): ReactNode => {
    if (typeof raw !== "object" || raw === null) return null;
    const node = raw as Node;
    const children = Array.isArray(node.content) ? node.content : null;
    const kids = (): ReactNode =>
      children?.map((child, i) => render(child, `${key}.${String(i)}`)) ?? null;

    switch (node.type) {
      case "text":
        return typeof node.text === "string"
          ? withMarks(node.text, marksOf(node), key, styles.code)
          : null;
      case "hardBreak":
        return <br key={key} />;
      case "mention": {
        const attrs = node.attrs;
        const label =
          typeof attrs === "object" && attrs !== null
            ? (attrs as { label?: unknown }).label
            : null;
        return (
          <span key={key} className={styles.mention}>
            @{typeof label === "string" ? label : "someone"}
          </span>
        );
      }
      case "paragraph":
        return (
          <p key={key} className={styles.p}>
            {kids()}
          </p>
        );
      case "bulletList":
        return (
          <ul key={key} className={styles.list}>
            {kids()}
          </ul>
        );
      case "orderedList":
        return (
          <ol key={key} className={styles.list}>
            {kids()}
          </ol>
        );
      case "listItem":
        return <li key={key}>{kids()}</li>;
      default:
        // UNKNOWN. Recurse if it has children; otherwise fall back to its own
        // text. Never return null while there are words inside.
        if (children !== null) return <Fragment key={key}>{kids()}</Fragment>;
        return typeof node.text === "string" ? (
          <Fragment key={key}>{node.text}</Fragment>
        ) : null;
    }
  };

  return <>{render(content, "c")}</>;
}

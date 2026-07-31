/**
 * The `JsonContent` grammar the comment RPCs carry, as data.
 *
 * MOVED from mobile (`plainTextContent`) plus the vocabulary its renderer
 * walks. The RENDERER stays per-client — mobile's takes its own `colors`, and
 * the tab's uses Fluent tokens — but the GRAMMAR is protocol and belongs in
 * one place:
 *
 *   block:  paragraph, bulletList, orderedList, listItem
 *   inline: text (marks bold/italic/code/strike), mention, hardBreak
 *
 * A node outside that vocabulary but carrying `content` RECURSES into its
 * children rather than being dropped; a childless unknown leaf falls back to
 * its own `text`. So an unrecognised node loses its formatting and never its
 * words — the sixteen-chips rule, in the comment grammar.
 */
import type { JsonContent } from "@traycer/protocol/common/registry";

/**
 * Text → the minimal document the comment RPCs accept.
 *
 * An empty string produces a paragraph with NO children rather than one
 * containing an empty text node: the schema rejects `{ type: "text", text: "" }`,
 * and the difference is invisible until someone submits a blank comment.
 */
export function plainTextContent(text: string): JsonContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: text.length === 0 ? [] : [{ type: "text", text }],
      },
    ],
  };
}

/**
 * Flattens a comment to plain text — for previews, notifications and
 * accessible names, never as a substitute for rendering it.
 *
 * Recurses through unknown nodes for the reason above: dropping a node we do
 * not recognise would silently shorten someone's comment.
 */
export function commentPlainText(content: JsonContent): string {
  const walk = (node: unknown): string => {
    if (typeof node !== "object" || node === null) return "";
    const n = node as Record<string, unknown>;
    if (n["type"] === "hardBreak") return "\n";
    if (typeof n["text"] === "string") return n["text"];
    const children = n["content"];
    if (!Array.isArray(children)) return "";
    const joined = children.map(walk).join("");
    // Block-level nodes end a line; inline ones do not.
    return n["type"] === "paragraph" || n["type"] === "listItem"
      ? `${joined}\n`
      : joined;
  };
  return walk(content).trim();
}

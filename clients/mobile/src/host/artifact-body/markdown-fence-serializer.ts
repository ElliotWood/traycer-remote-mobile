/**
 * Ported verbatim from `clients/gui-app/src/editor-core/nodes/shared/markdown-fence-serializer.ts`
 * (no DOM/React dependency there, so nothing to drop). Shared helpers for
 * serializing atom-block nodes that persist as standard fenced code blocks in
 * markdown. Mermaid uses ` ```mermaid `, wireframe uses ` ```wireframe `.
 */
import type { MarkdownToken } from "@tiptap/core";

/**
 * Returns a fence delimiter of at least three backticks that is guaranteed
 * not to collide with any run of backticks inside `body`.
 */
function pickFence(body: string): string {
  const matches = body.match(/`{3,}/g);
  if (matches === null) return "```";
  const longest = matches.reduce((n, m) => Math.max(n, m.length), 3);
  return "`".repeat(longest + 1);
}

/**
 * Formats a fenced code block for markdown output. A trailing newline is
 * NOT included - the Markdown extension joins block siblings with `\n\n`
 * so nodes must not over-emit newlines.
 */
export function renderFencedBlock(language: string, body: string): string {
  const fence = pickFence(body);
  return `${fence}${language}\n${body}\n${fence}`;
}

/**
 * Returns `true` when the incoming `code` token matches the expected fence
 * language.
 */
export function matchesFenceLanguage(
  token: MarkdownToken,
  language: string,
): boolean {
  if (token.type !== "code") return false;
  const lang =
    typeof (token as { lang?: unknown }).lang === "string"
      ? (token as { lang: string }).lang.trim()
      : "";
  return lang === language;
}

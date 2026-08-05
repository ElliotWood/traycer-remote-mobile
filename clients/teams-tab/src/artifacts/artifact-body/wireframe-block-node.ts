/**
 * Schema-level port of `clients/gui-app/src/editor-core/nodes/wireframe/wireframe-node.ts`.
 * See `mermaid-block-node.ts` for the rationale on what is dropped (the DOM/
 * React NodeView half) and why the node `name` ("uiPreviewBlock") and the
 * `htmlContent` attr must stay byte-exact with the desktop definition.
 *
 * `title` is intentionally NOT round-tripped through markdown (matches
 * desktop: `renderFencedBlock` only ever emits `htmlContent`) — a
 * documented, accepted lossy field, not a gap.
 */
import { Node } from "@tiptap/core";
import type { MarkdownToken, MarkdownParseHelpers } from "@tiptap/core";
import {
  matchesFenceLanguage,
  renderFencedBlock,
} from "./markdown-fence-serializer";

const FENCE_LANGUAGE = "wireframe";
const DEFAULT_TITLE = "UI Preview";

export interface WireframeAttrs {
  readonly htmlContent: string;
  readonly title: string;
}

export const WireframeBlockNode = Node.create({
  name: "uiPreviewBlock",

  group: "block",
  atom: true,
  isolating: true,
  defining: true,
  draggable: false,
  selectable: true,

  addAttributes() {
    return {
      htmlContent: {
        default: "",
      },
      title: {
        default: DEFAULT_TITLE,
      },
    };
  },

  markdownTokenName: "code",

  parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers) => {
    if (!matchesFenceLanguage(token, FENCE_LANGUAGE)) return [];
    const text = typeof token.text === "string" ? token.text : "";
    return helpers.createNode(
      "uiPreviewBlock",
      { htmlContent: text, title: DEFAULT_TITLE },
      [],
    );
  },

  renderMarkdown: (node): string => {
    const attrs = (node as { attrs?: { htmlContent?: string } }).attrs;
    const html =
      attrs && typeof attrs.htmlContent === "string" ? attrs.htmlContent : "";
    return renderFencedBlock(FENCE_LANGUAGE, html);
  },
});

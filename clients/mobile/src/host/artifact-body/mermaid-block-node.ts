/**
 * Schema-level port of `clients/gui-app/src/editor-core/nodes/mermaid/mermaid-node.ts`.
 *
 * Mobile never mounts an editable Tiptap `Editor` — it only builds a
 * `schema` to reconstruct a ProseMirror doc from a Y.XmlFragment
 * (`yXmlFragmentToProseMirrorRootNode`) and serialize it back to markdown
 * (`MarkdownManager.serialize`). So this keeps ONLY what those two pure
 * operations need: `name`/`group`/`atom`/`attrs`/`markdownTokenName`/
 * `parseMarkdown`/`renderMarkdown`. `addNodeView`/`parseHTML`/`renderHTML`
 * (the DOM/React half) are dropped — there is no DOM to render into.
 *
 * The node `name` ("mermaidBlock") and the `code` attr MUST stay byte-exact
 * with the desktop definition: `yXmlFragmentToProseMirrorRootNode` matches
 * Y.XmlElements to schema node types by name, so a mismatch silently drops
 * every mermaid block a real artifact body contains.
 */
import { Node } from "@tiptap/core";
import type { MarkdownToken, MarkdownParseHelpers } from "@tiptap/core";
import {
  matchesFenceLanguage,
  renderFencedBlock,
} from "./markdown-fence-serializer";

const FENCE_LANGUAGE = "mermaid";

export interface MermaidAttrs {
  readonly code: string;
}

export const MermaidBlockNode = Node.create({
  name: "mermaidBlock",

  group: "block",
  atom: true,
  isolating: true,
  defining: true,
  draggable: false,
  selectable: true,

  addAttributes() {
    return {
      code: {
        default: "",
      },
    };
  },

  markdownTokenName: "code",

  parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers) => {
    if (!matchesFenceLanguage(token, FENCE_LANGUAGE)) return [];
    const text = typeof token.text === "string" ? token.text : "";
    return helpers.createNode("mermaidBlock", { code: text }, []);
  },

  renderMarkdown: (node): string => {
    const attrs = (node as { attrs?: { code?: string } }).attrs;
    const code = attrs && typeof attrs.code === "string" ? attrs.code : "";
    return renderFencedBlock(FENCE_LANGUAGE, code);
  },
});

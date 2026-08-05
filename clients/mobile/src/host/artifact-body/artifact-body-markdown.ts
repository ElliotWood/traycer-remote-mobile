/**
 * Artifact-body → markdown serialization (Mobile v2, Sprint 3 / F2).
 *
 * Mirrors `clients/gui-app/src/editor-core/artifact-document-bundle.ts` —
 * the desktop's own "Y.XmlFragment → markdown" path — scoped to what a
 * READ-ONLY render needs: a `schema` built from the same node/mark set
 * (minus every NodeView/DOM concern desktop needs for its editable
 * `Editor`), `yXmlFragmentToProseMirrorRootNode` to reconstruct the
 * ProseMirror doc from the artifact-room's Y.XmlFragment, and
 * `MarkdownManager.serialize` to turn that back into the markdown string
 * Sprint 1's `MobileMarkdown` already knows how to render (including its
 * ` ```mermaid `/` ```wireframe ` fences).
 *
 * This module (and everything it imports — `@tiptap/core`, `@tiptap/pm`,
 * `@tiptap/starter-kit`, `@tiptap/markdown`, `@tiptap/y-tiptap`,
 * `@tiptap/extension-table`, etc.) is heavier than Sprint 1's `mermaid` and
 * MUST stay off the initial route. Callers dynamic-`import()` it — see
 * `use-artifact-body.ts` — never a static top-level import from a tree/list
 * view.
 */
import { getSchema, type AnyExtension, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  Table,
  TableRow,
  TableHeader,
  TableCell,
} from "@tiptap/extension-table";
import { yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap";
import type * as Y from "yjs";
import { MermaidBlockNode } from "./mermaid-block-node";
import { WireframeBlockNode } from "./wireframe-block-node";
import { ThreadAnchorMark } from "./thread-anchor-mark";

// `codeBlock` stays at its StarterKit default (unmodified `Partial<CodeBlockOptions>`,
// i.e. NOT `false`) so a persisted, never-promoted `codeBlock{language:mermaid|
// wireframe}` node (see module docs on `FencePromotionPlugin`) still serializes
// via the stock codeBlock markdown path. `link` is disabled here because we add
// our own `Link` extension below, exactly like desktop.
const extensions: AnyExtension[] = [
  StarterKit.configure({ link: false }),
  Markdown,
  Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Table,
  TableRow,
  TableHeader,
  TableCell,
  MermaidBlockNode,
  WireframeBlockNode,
  ThreadAnchorMark,
];

/**
 * Exported (not just module-private) so tests can build a Y.XmlFragment via
 * `@tiptap/y-tiptap`'s `prosemirrorJSONToYXmlFragment(schema, json, fragment)`
 * — the SAME construction desktop's own oracle test uses for
 * `artifactDocumentBundle.schema` — and assert `serializeArtifactBody`'s
 * output byte-for-byte against known input, not just "contains a fence".
 */
export const schema = getSchema(extensions);
const markdownManager = new MarkdownManager({ extensions });

function isJsonContent(value: unknown): value is JSONContent {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  const candidate = value as { type: unknown; content?: unknown };
  if (typeof candidate.type !== "string") return false;
  if (!("content" in candidate) || candidate.content === undefined) {
    return true;
  }
  return (
    Array.isArray(candidate.content) &&
    candidate.content.every(isJsonContent)
  );
}

/**
 * Serializes an artifact body's Y.XmlFragment (`artifact-body:{artifactId}`
 * inside the artifact's room doc) to markdown. Throws on a malformed/
 * unreconstructable fragment — callers (`useArtifactBody`) catch this and
 * surface a labeled fallback, never propagate past the hook (rubric §3: "no
 * crashes/blank screens ... or a labeled fallback, never a throw").
 */
export function serializeArtifactBody(fragment: Y.XmlFragment): string {
  const root = yXmlFragmentToProseMirrorRootNode(fragment, schema);
  const json: unknown = root.toJSON();
  if (!isJsonContent(json)) {
    throw new Error("Artifact body could not be serialized.");
  }
  return markdownManager.serialize(json);
}

/**
 * Schema-level port of `clients/gui-app/src/editor-core/extensions/thread-anchor.ts`.
 *
 * Mobile bodies are read-only this sprint (comments are Sprint 4) — this mark
 * exists SOLELY so a real artifact body that already carries comment anchors
 * doesn't throw when `yXmlFragmentToProseMirrorRootNode` reconstructs the
 * doc (an unmatched mark name is a hard failure there, same risk as an
 * unmatched node name). No visual decoration; `@tiptap/markdown` has no
 * configured markdown syntax for it, so it serializes as plain inner text
 * (the same default every other undecorated mark gets).
 */
import { Mark } from "@tiptap/core";

export const ThreadAnchorMark = Mark.create({
  name: "threadAnchor",
  inclusive: false,
  excludes: "",

  addAttributes() {
    return {
      threadId: {
        default: null,
      },
    };
  },
});

/**
 * WHY THE TWO PROJECTIONS ARE NOT THE SAME PROJECTION.
 *
 * `transcript.ts` and `transcript-tree.ts` now sit in one directory, both
 * named for the transcript, both taking blocks. The next reader who wants to
 * tidy will try to merge them. This file is the argument against that, written
 * as assertions rather than as a docblock nobody has to keep true.
 *
 * The distinction is SHAPE vs WORDS:
 *
 *   transcript.ts       what a block is CALLED. Lossy by design — a chip
 *                       needs a label and nothing else.
 *   transcript-tree.ts  which blocks render, nested how, and which are
 *                       REPLACED by another. Lossless — callers get the
 *                       `ContentBlock`.
 *
 * The parity contract records the tab's transcript as ✅ on the strength of
 * "16 block kinds named, not dropped". That is true, and it is a claim about
 * the FIRST projection. Whether the tab can render what mobile renders is a
 * claim about the SECOND, and the answer was no: the payload is discarded
 * before any tab renderer sees it. Two true statements about neighbouring
 * questions — this project's most repeated error, so it is pinned here.
 */
import { describe, expect, it } from "vitest";
import type { ContentBlock } from "@traycer/protocol/persistence/epic/content-blocks";
import { toTranscriptBlock } from "../transcript";
import { buildBlockTree } from "../transcript-tree";

function toolCall(blockId: string): ContentBlock {
  return {
    type: "tool_call",
    blockId,
    status: "completed",
    timestamp: 0,
    parentBlockId: null,
    toolName: "Bash",
    inputSummary: "ls -la",
    inputDetail: null,
    taskTodoItems: null,
    error: null,
    agentMessageSend: null,
    progress: null,
    backgroundOutput: null,
    startedAt: null,
    endedAt: null,
    backgroundTask: false,
    stopped: false,
  };
}

function fileChange(blockId: string): ContentBlock {
  return {
    type: "file_change",
    blockId,
    status: "completed",
    timestamp: 0,
    parentBlockId: null,
    filePath: "a.ts",
    operation: "edit",
    diffSource: "snapshot",
    beforeHash: "b",
    afterHash: "a",
    additions: 1,
    deletions: 1,
    reason: "snapshot",
  };
}

describe("the label projection discards what a renderer would draw", () => {
  it("reduces a tool call to a label, keeping no payload", () => {
    const projected = toTranscriptBlock(toolCall("t1"));

    // It names the thing well — this is the property the contract's ✅ is about.
    expect(projected).toStrictEqual({
      kind: "other",
      blockType: "tool_call",
      label: "Tool call: Bash",
    });

    // And that object is the WHOLE of what a downstream renderer receives.
    // `inputSummary`, `status`, `blockId` and the rest are unreachable — so a
    // tab renderer downstream of this cannot draw a tool call however well it
    // is written. If this ever stops being true, the move that put
    // `transcript-tree.ts` in `shared` has been undone.
    expect(Object.keys(projected).sort()).toStrictEqual([
      "blockType",
      "kind",
      "label",
    ]);
  });

  it("hands the block through intact via the tree projection", () => {
    const block = toolCall("t1");
    const tree = buildBlockTree([block]);

    expect(tree).toHaveLength(1);
    expect(tree[0]?.block).toBe(block);
    expect(tree[0]?.block).toMatchObject({
      toolName: "Bash",
      inputSummary: "ls -la",
      status: "completed",
    });
  });
});

describe("only the tree projection knows a block was replaced", () => {
  /**
   * The concrete cost of rendering from labels alone, and the reason
   * `computeSuppressed` was ported from desktop rather than invented: an edit
   * arrives as a `tool_call` AND the `file_change` it produced. The file
   * change card replaces the tool call. Without that rule the reader sees the
   * same edit twice and cannot tell it is one edit.
   */
  const blocks = [toolCall("t1"), fileChange("t1:a.ts")];

  it("labels both, because it has no notion of replacement", () => {
    expect(blocks.map((b) => toTranscriptBlock(b))).toStrictEqual([
      { kind: "other", blockType: "tool_call", label: "Tool call: Bash" },
      { kind: "other", blockType: "file_change", label: "File change: a.ts" },
    ]);
  });

  it("renders one node, the file change, having suppressed its tool call", () => {
    const tree = buildBlockTree(blocks);

    expect(tree).toHaveLength(1);
    expect(tree[0]?.block.blockId).toBe("t1:a.ts");
    expect(tree[0]?.block.type).toBe("file_change");
  });
});

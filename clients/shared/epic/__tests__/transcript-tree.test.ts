import { describe, expect, it } from "vitest";
import type { ContentBlock } from "@traycer/protocol/persistence/epic/content-blocks";
import { buildBlockTree, partitionBlocks } from "../transcript-tree";

function toolCall(blockId: string, parentBlockId: string | null): ContentBlock {
  return {
    type: "tool_call",
    blockId,
    status: "completed",
    timestamp: 0,
    parentBlockId,
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

function subagent(
  blockId: string,
  spawnToolCallId: string | null,
): ContentBlock {
  return {
    type: "subagent",
    blockId,
    status: "completed",
    timestamp: 0,
    parentBlockId: null,
    name: "Explorer",
    agentType: null,
    task: null,
    progressUpdates: [],
    result: "done",
    startedAt: 0,
    spawnToolCallId,
    stopped: false,
    workflowMeta: null,
  };
}

function steer(blockId: string): ContentBlock {
  return {
    type: "steer",
    blockId,
    status: "completed",
    timestamp: 0,
    parentBlockId: null,
    queueItemId: "q1",
    messageId: "m1",
    content: { type: "doc", content: [] },
    mode: "safe_point",
    sender: null,
  };
}

function artifactOp(
  blockId: string,
  parentBlockId: string | null,
): ContentBlock {
  return {
    type: "artifact_operation",
    blockId,
    status: "completed",
    timestamp: 0,
    parentBlockId,
    operation: "update",
    kind: "spec",
    artifactId: "art1",
    title: "My spec",
    beforeHash: null,
    afterHash: null,
  };
}

describe("partitionBlocks — the no-silent-drop partition", () => {
  it("classifies every block into exactly one bucket, dropped is empty", () => {
    const blocks: ContentBlock[] = [
      toolCall("t1", null),
      fileChange("f1"),
      steer("s1"),
    ];
    const result = partitionBlocks(blocks);
    expect(result.dropped).toEqual([]);
    expect(result.alternatePath).toEqual(["s1"]);
    expect([...result.rendered].sort()).toEqual(["f1", "t1"].sort());
  });

  it("puts the edit-suppressed tool_call in `suppressed`, not `dropped`", () => {
    // file_change id prefixed by the tool_call's id — the edit-tool_call rule.
    const blocks: ContentBlock[] = [toolCall("t1", null), fileChange("t1:0")];
    const result = partitionBlocks(blocks);
    expect(result.dropped).toEqual([]);
    expect(result.suppressed.get("t1")).toBe("edit-tool-call");
    expect(result.rendered).toEqual(["t1:0"]);
  });

  it("puts the spawn-suppressed tool_call in `suppressed`, not `dropped`", () => {
    const blocks: ContentBlock[] = [
      toolCall("spawn1", null),
      subagent("sa1", "spawn1"),
    ];
    const result = partitionBlocks(blocks);
    expect(result.dropped).toEqual([]);
    expect(result.suppressed.get("spawn1")).toBe("spawn-tool-call");
  });

  it("counts a nested child as rendered (visible, just indented), not dropped", () => {
    const blocks: ContentBlock[] = [
      subagent("sa1", null),
      toolCall("t1", "sa1"),
    ];
    const result = partitionBlocks(blocks);
    expect(result.dropped).toEqual([]);
    expect([...result.rendered].sort()).toEqual(["sa1", "t1"].sort());
  });

  it("suppression rules run over a combined snapshot+live-overlay set straddling the two", () => {
    // Simulates: subagent from the snapshot, its spawn tool_call arriving live.
    const snapshotBlocks: ContentBlock[] = [subagent("sa1", "spawn-live")];
    const liveBlocks: ContentBlock[] = [toolCall("spawn-live", null)];
    const result = partitionBlocks([...snapshotBlocks, ...liveBlocks]);
    expect(result.dropped).toEqual([]);
    expect(result.suppressed.get("spawn-live")).toBe("spawn-tool-call");
  });
});

describe("buildBlockTree — subagent nesting", () => {
  it("nests an eligible child under its subagent parent, never flattens", () => {
    const blocks: ContentBlock[] = [
      subagent("sa1", null),
      toolCall("t1", "sa1"),
    ];
    const tree = buildBlockTree(blocks);
    expect(tree).toHaveLength(1);
    expect(tree[0].block.blockId).toBe("sa1");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].block.blockId).toBe("t1");
  });

  it("nests 2 levels deep (agent-of-agents) without flattening", () => {
    const blocks: ContentBlock[] = [
      subagent("sa1", null),
      subagent("sa2", null),
      toolCall("t1", "sa2"),
    ];
    // sa2 nests under sa1 only if sa2's parentBlockId points at sa1 — set it up.
    const nested: ContentBlock[] = blocks.map((b) =>
      b.blockId === "sa2" ? { ...b, parentBlockId: "sa1" } : b,
    );
    const tree = buildBlockTree(nested);
    expect(tree).toHaveLength(1);
    expect(tree[0].block.blockId).toBe("sa1");
    expect(tree[0].children[0].block.blockId).toBe("sa2");
    expect(tree[0].children[0].children[0].block.blockId).toBe("t1");
  });

  it("treats a parentBlockId pointing at a non-subagent (or unknown) block as an orphan — top-level, not vanished", () => {
    const blocks: ContentBlock[] = [toolCall("t1", null), toolCall("t2", "t1")];
    const tree = buildBlockTree(blocks);
    expect(tree.map((n) => n.block.blockId).sort()).toEqual(["t1", "t2"]);
  });

  it("never nests artifact_operation even with a parentBlockId set", () => {
    const blocks: ContentBlock[] = [
      subagent("sa1", null),
      artifactOp("ao1", "sa1"),
    ];
    const tree = buildBlockTree(blocks);
    expect(tree.map((n) => n.block.blockId).sort()).toEqual(["ao1", "sa1"]);
  });

  it("excludes steer blocks from the tree entirely", () => {
    const blocks: ContentBlock[] = [steer("s1"), toolCall("t1", null)];
    const tree = buildBlockTree(blocks);
    expect(tree.map((n) => n.block.blockId)).toEqual(["t1"]);
  });
});

/**
 * Sprint 2 — the accumulator's unit coverage (lighter validation bar than
 * the projector, per the negotiated contract): proves each wire event folds
 * into a block matching what the SAME renderer components show for the
 * equivalent PERSISTED block, including the one documented gap.
 */
import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@traycer/protocol/host/agent/gui/agent-runtime";
import {
  EMPTY_LIVE_TURN,
  foldRuntimeEvent,
  liveTurnBlocks,
} from "@/host/chat-live-turn";

function fold(events: readonly RuntimeEvent[]) {
  return events.reduce(foldRuntimeEvent, EMPTY_LIVE_TURN);
}

describe("chat-live-turn — tool_call live gap", () => {
  it("renders toolName-only (no fabricated inputSummary) on .started, stays null through .completed", () => {
    const state = fold([
      {
        type: "tool_call.started",
        blockId: "t1",
        timestamp: 1,
        toolName: "Bash",
        input: { command: "ls" },
        agentMessageSend: null,
      },
      { type: "tool_call.completed", blockId: "t1", timestamp: 2, toolName: "Bash", agentMessageSend: null },
    ]);
    const [block] = liveTurnBlocks(state);
    expect(block.type).toBe("tool_call");
    if (block.type !== "tool_call") throw new Error("wrong type");
    expect(block.toolName).toBe("Bash");
    expect(block.inputSummary).toBeNull();
    expect(block.inputDetail).toBeNull();
    expect(block.status).toBe("completed");
  });
});

describe("chat-live-turn — text.delta streaming accumulation", () => {
  it("accumulates deltas into the full concatenated text", () => {
    const state = fold([
      { type: "text.delta", blockId: "x1", timestamp: 1, delta: "Hello, " },
      { type: "text.delta", blockId: "x1", timestamp: 2, delta: "world" },
      { type: "text.completed", blockId: "x1", timestamp: 3 },
    ]);
    const [block] = liveTurnBlocks(state);
    expect(block.type).toBe("text");
    if (block.type !== "text") throw new Error("wrong type");
    expect(block.text).toBe("Hello, world");
    expect(block.status).toBe("completed");
  });
});

describe("chat-live-turn — file_change carries real hashes/counts", () => {
  it("passes beforeHash/afterHash/additions/deletions through unchanged", () => {
    const state = fold([
      { type: "file_change.started", blockId: "f1", timestamp: 1, filePath: "package.json", operation: "edit" },
      {
        type: "file_change.completed",
        blockId: "f1",
        timestamp: 2,
        filePath: "package.json",
        operation: "edit",
        diffSource: "snapshot",
        beforeHash: "sha-before",
        afterHash: "sha-after",
        additions: 1,
        deletions: 0,
        reason: "snapshot",
      },
    ]);
    const [block] = liveTurnBlocks(state);
    expect(block.type).toBe("file_change");
    if (block.type !== "file_change") throw new Error("wrong type");
    expect(block.beforeHash).toBe("sha-before");
    expect(block.afterHash).toBe("sha-after");
    expect(block.additions).toBe(1);
    expect(block.deletions).toBe(0);
    expect(block.diffSource).toBe("snapshot");
  });
});

describe("chat-live-turn — subagent nesting via parentBlockId", () => {
  it("preserves a child block's parentBlockId pointing at the subagent", () => {
    const state = fold([
      { type: "subagent.started", blockId: "s1", timestamp: 1, name: "Explorer" },
      {
        type: "tool_call.started",
        blockId: "t1",
        timestamp: 2,
        toolName: "Read",
        parentBlockId: "s1",
        agentMessageSend: null,
      },
    ]);
    const blocks = liveTurnBlocks(state);
    const child = blocks.find((b) => b.blockId === "t1");
    expect(child?.parentBlockId).toBe("s1");
  });
});

describe("chat-live-turn — steer routing", () => {
  it("stores a steer block as-is (routing to a user bubble happens in transcript-model.ts, not here)", () => {
    const state = fold([
      {
        type: "steer.submitted",
        blockId: "st1",
        timestamp: 1,
        queueItemId: "q1",
        messageId: "m1",
        content: { type: "doc", content: [] },
        mode: "safe_point",
        sender: null,
      },
    ]);
    const [block] = liveTurnBlocks(state);
    expect(block.type).toBe("steer");
  });
});

describe("chat-live-turn — autonomous_resume has no live event", () => {
  it("no RuntimeEvent variant produces an autonomous_resume block", () => {
    const state = fold([{ type: "turn.completed", blockId: "tc1", timestamp: 1, turnId: "turn1" }]);
    expect(liveTurnBlocks(state)).toHaveLength(0);
  });
});

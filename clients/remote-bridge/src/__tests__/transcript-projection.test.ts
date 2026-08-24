import { describe, expect, it } from "vitest";
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from "@traycer/protocol/persistence/epic/messages";
import type { ContentBlock } from "@traycer/protocol/persistence/epic/content-blocks";
import type { JsonContent } from "@traycer/protocol/common/registry";
import { projectMessage, selectWindow } from "../transcript-projection";

/**
 * Fixtures are typed as the REAL protocol types, not cast through `unknown`.
 * That costs a few more fields per block and buys the thing that matters: a
 * schema change breaks these fixtures instead of letting them drift from
 * what the projection actually receives at runtime.
 */
function userMessage(id: string): UserMessage {
  const content: JsonContent = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: id }] }],
  } as JsonContent;
  return {
    role: "user",
    messageId: id,
    sender: { type: "user", userId: "u-1" },
    message: { kind: "user", content },
    timestamp: Number(id),
    sessionAnchor: null,
  };
}

/** Fills the four fields every content block carries, so tests stay readable. */
function block(
  partial: Partial<ContentBlock> & { type: string },
): ContentBlock {
  return {
    blockId: `b-${partial.type}`,
    status: "completed",
    timestamp: 0,
    parentBlockId: null,
    ...partial,
  } as ContentBlock;
}

function assistantWith(blocks: ContentBlock[]): AssistantMessage {
  return {
    role: "assistant",
    messageId: "a-1",
    sender: {
      type: "agent",
      harnessId: "claude",
      agentId: "ag-1",
      displayName: "claude",
      reply: { expectsReply: false },
      inReplyTo: null,
    },
    blocks,
    startedAt: null,
    timestamp: 1,
    turnId: null,
    usage: null,
    reasoningEffort: null,
    serviceTier: null,
  };
}

/**
 * `selectWindow`'s two orderings — window chosen from the RECENT end,
 * contents in natural order — are exactly where an off-by-one hides, and the
 * offset direction had already been specified two contradictory ways once
 * before this test existed. So it is pinned with a sequence whose values
 * make the direction unmistakable.
 */
function seq(n: number): readonly Message[] {
  return Array.from({ length: n }, (_, i) => userMessage(String(i)));
}

const ids = (messages: readonly Message[]): string[] =>
  messages.map((m) => m.messageId);

describe("remote-bridge/transcript-projection — selectWindow", () => {
  it("offset 0 returns the NEWEST messages, not the oldest", () => {
    // The whole point of the offset direction. Getting this backwards would
    // present as "page 1 shows the start of the conversation".
    expect(ids(selectWindow(seq(10), 0, 3))).toEqual(["7", "8", "9"]);
  });

  it("returns the window OLDEST-FIRST within itself", () => {
    // Window chosen from the end; contents in natural order. The card
    // decides display order, not this function.
    const window = selectWindow(seq(10), 0, 3);
    expect(ids(window)).toEqual(["7", "8", "9"]);
    expect(window[0].timestamp).toBeLessThan(window[2].timestamp);
  });

  it("offset walks BACKWARDS through history, without gaps or overlap", () => {
    const all = seq(10);
    expect(ids(selectWindow(all, 0, 3))).toEqual(["7", "8", "9"]);
    expect(ids(selectWindow(all, 3, 3))).toEqual(["4", "5", "6"]);
    expect(ids(selectWindow(all, 6, 3))).toEqual(["1", "2", "3"]);
    // The last page is short rather than reaching past the start.
    expect(ids(selectWindow(all, 9, 3))).toEqual(["0"]);
  });

  it("CONTRACT: a loaded page keeps its contents when a new message arrives", () => {
    // This is the property the offset direction was chosen FOR. Anchored to
    // the oldest message instead, every boundary would shift on each new
    // message and a reader on page 2 would watch it reshuffle.
    const before = seq(10);
    const pageTwoBefore = ids(selectWindow(before, 3, 3));

    const after = [...before, userMessage("10")];
    // The same page is now one further from the recent end.
    const pageTwoAfter = ids(selectWindow(after, 4, 3));

    expect(pageTwoAfter).toEqual(pageTwoBefore);
  });

  it("an offset past the start yields an empty window, never a negative slice", () => {
    // `Array.slice` treats a negative start as an offset from the END, so an
    // unclamped computation here would silently return the NEWEST messages
    // for an offset meant to be past the oldest — the worst possible answer.
    expect(ids(selectWindow(seq(5), 99, 3))).toEqual([]);
  });

  it("a limit larger than the history returns everything, in order", () => {
    expect(ids(selectWindow(seq(3), 0, 50))).toEqual(["0", "1", "2"]);
  });

  it("an empty history is empty, not a throw", () => {
    expect(ids(selectWindow([], 0, 5))).toEqual([]);
  });
});

describe("remote-bridge/transcript-projection — projectMessage", () => {
  it("renders a user message's ProseMirror doc as text, not as an object", () => {
    const projected = projectMessage(userMessage("hello"));
    expect(projected.role).toBe("user");
    expect(projected.text).toContain("hello");
    expect(projected.text).not.toContain("paragraph");
  });

  it("keeps text blocks as prose and collapses everything else to parts", () => {
    const projected = projectMessage(
      assistantWith([
        block({ type: "text", text: "Running the tests now." }),
        block({ type: "command", command: "bun test" }),
        block({ type: "file_change", filePath: "cards.ts" }),
      ]),
    );

    expect(projected.text).toBe("Running the tests now.");
    expect(projected.parts).toEqual([
      { kind: "command", label: "bun test", lines: 0 },
      { kind: "file_change", label: "cards.ts", lines: 0 },
    ]);
  });

  it("a message with no text blocks yields empty prose, not a placeholder", () => {
    // The CARD decides how to present a parts-only message; inventing text
    // here would put words in the agent's mouth.
    const projected = projectMessage(
      assistantWith([block({ type: "command", command: "ls" })]),
    );
    expect(projected.text).toBe("");
    expect(projected.parts).toHaveLength(1);
  });

  it("reasoning becomes a marker, never prose — it would swamp a scanning surface", () => {
    const projected = projectMessage(
      assistantWith([
        block({ type: "reasoning", content: "line one\nline two\nline three" }),
        block({ type: "text", text: "Done." }),
      ]),
    );
    expect(projected.text).toBe("Done.");
    expect(projected.parts).toEqual([
      { kind: "other", label: "reasoning", lines: 3 },
    ]);
  });

  it("names the author from the sender rather than leaving it null", () => {
    expect(projectMessage(assistantWith([])).author).toBe("claude");
  });

  it("joins several text blocks with a blank line, preserving their order", () => {
    const projected = projectMessage(
      assistantWith([
        block({ type: "text", text: "First." }),
        block({ type: "command", command: "x" }),
        block({ type: "text", text: "Second." }),
      ]),
    );
    expect(projected.text).toBe("First.\n\nSecond.");
  });

  it("an error block is a marker, so a failed turn is visible rather than blank", () => {
    const projected = projectMessage(
      assistantWith([
        block({ type: "error", message: "provider timed out", code: null }),
      ]),
    );
    expect(projected.parts).toEqual([
      { kind: "error", label: "provider timed out", lines: 0 },
    ]);
  });
});

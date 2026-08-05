/**
 * Pure unit tests for the chat-tree projections (T6).
 *
 * `interviewBlockFor` is the load-bearing resolver: a pending interview carries
 * only a `blockId`, and the prompt must be found in the `type:"interview"`
 * content block inside `chat.messages[]`. These tests assert it finds the block
 * by id, ignores non-interview and id-mismatched blocks, and returns null when
 * the block is not present yet (the loading-state cue).
 */
import { describe, expect, it } from "vitest";
import {
  interviewBlockFor,
  latestActivityText,
  type ChatMessage,
} from "../chat-projection";

/** Minimal assistant message carrying the given blocks (only the read fields). */
function assistantWith(blocks: readonly unknown[]): ChatMessage {
  return { role: "assistant", blocks } as unknown as ChatMessage;
}

function userMessage(): ChatMessage {
  return { role: "user", blocks: [] } as unknown as ChatMessage;
}

const interviewBlock = (blockId: string, question: string): unknown => ({
  type: "interview",
  blockId,
  title: null,
  questions: [
    { questionId: "q1", question, header: null, options: [], multiSelect: false },
  ],
});

const textBlock = (blockId: string, text: string): unknown => ({
  type: "text",
  blockId,
  text,
});

describe("interviewBlockFor", () => {
  it("finds the interview block by id inside an assistant message", () => {
    const messages = [
      userMessage(),
      assistantWith([textBlock("t1", "hi"), interviewBlock("iv1", "Pick one")]),
    ];
    const found = interviewBlockFor(messages, "iv1");
    expect(found).not.toBeNull();
    expect(found?.questions[0].question).toBe("Pick one");
  });

  it("returns null when no interview block matches the id (loading cue)", () => {
    const messages = [assistantWith([interviewBlock("iv1", "Pick one")])];
    expect(interviewBlockFor(messages, "other")).toBeNull();
  });

  it("ignores a non-interview block that happens to share the id", () => {
    const messages = [assistantWith([textBlock("iv1", "not an interview")])];
    expect(interviewBlockFor(messages, "iv1")).toBeNull();
  });

  it("returns null for an empty tree", () => {
    expect(interviewBlockFor([], "iv1")).toBeNull();
  });
});

describe("latestActivityText", () => {
  it("returns the most recent non-empty assistant text, collapsed to one line", () => {
    const messages = [
      assistantWith([textBlock("t1", "first")]),
      assistantWith([textBlock("t2", "second\n  line")]),
    ];
    expect(latestActivityText(messages)).toBe("second line");
  });

  it("returns empty string when there is no assistant text", () => {
    expect(latestActivityText([userMessage()])).toBe("");
  });
});

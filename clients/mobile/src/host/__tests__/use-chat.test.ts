// @vitest-environment jsdom
/**
 * Sprint 2 must-fix #3: the live overlay (accepted user rows + accumulated
 * blocks) must never survive alongside a fresh snapshot that already
 * contains the now-persisted turn — a duplicated transcript on turn
 * completion is a real §4 fidelity bug, not cosmetic.
 */
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@/test-utils/dom";
import { createFakeStreamConnection } from "@/test-utils/fakes";
import { useChat } from "@/host/use-chat";

function userMessage(messageId: string, text: string) {
  return {
    role: "user",
    messageId,
    sender: { type: "user", userId: "u1" },
    message: {
      kind: "user",
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
    },
    timestamp: 0,
    sessionAnchor: null,
  };
}

function assistantMessage(messageId: string, text: string) {
  return {
    role: "assistant",
    messageId,
    sender: { type: "agent", harnessId: "claude", agentId: "a1", displayName: null, reply: { expectsReply: false }, inReplyTo: null },
    blocks: [
      {
        type: "text",
        blockId: `${messageId}-b1`,
        status: "completed",
        timestamp: 0,
        parentBlockId: null,
        text,
        providerNotice: null,
      },
    ],
    startedAt: 0,
    timestamp: 0,
    turnId: "turn1",
    usage: null,
  };
}

function snapshotFrame(messages: readonly unknown[]) {
  return {
    kind: "snapshot",
    snapshot: {
      runStatus: "idle",
      chat: { title: "Chat", messages, settings: null },
      access: { role: "owner", ownerUserId: "u1" },
      queue: { status: "idle", items: [] },
      pendingApprovals: [],
      pendingFileEditApprovals: [],
      pendingInterviews: [],
      accumulatedFileChanges: [],
      activeTurn: null,
    },
  } as unknown as never;
}

describe("useChat — snapshot/live-overlay reconciliation", () => {
  it("resets trailingMessages + liveTurn on a fresh snapshot: no duplicate messageId or blockId", () => {
    const fake = createFakeStreamConnection();
    const { result } = renderHook(() => useChat(fake.connection, "e1", "c1", "u1"));
    const callbacks = () => fake.chatSessions[0].callbacks;

    // A: initial snapshot with one turn already persisted.
    act(() => {
      callbacks().onSnapshot(snapshotFrame([userMessage("u1", "hello")]));
    });
    expect(result.current.transcriptMessages.map((m) => m.messageId)).toEqual(["u1"]);

    // A new user message is accepted, then the assistant streams a reply live.
    act(() => {
      callbacks().onMessageAccepted({ message: userMessage("u2", "follow up") } as unknown as never);
    });
    act(() => {
      callbacks().onBlockDelta({
        event: { type: "text.delta", blockId: "live-b1", timestamp: 1, delta: "Working on it" },
      } as unknown as never);
    });

    expect(result.current.transcriptMessages.map((m) => m.messageId)).toEqual(["u1", "u2"]);
    expect(result.current.liveTurnBlocks).toHaveLength(1);

    // B: a fresh snapshot arrives already containing u2 + the persisted assistant reply.
    act(() => {
      callbacks().onSnapshot(
        snapshotFrame([userMessage("u1", "hello"), userMessage("u2", "follow up"), assistantMessage("a2", "Working on it")]),
      );
    });

    const finalMessageIds = result.current.transcriptMessages.map((m) => m.messageId);
    expect(finalMessageIds).toEqual(["u1", "u2", "a2"]);
    // No duplicate messageId.
    expect(new Set(finalMessageIds).size).toBe(finalMessageIds.length);
    // The live overlay is gone — B is fully authoritative.
    expect(result.current.liveTurnBlocks).toHaveLength(0);
  });

  it("onMessageAccepted does not duplicate a message the snapshot already carries", () => {
    const fake = createFakeStreamConnection();
    const { result } = renderHook(() => useChat(fake.connection, "e1", "c1", "u1"));
    const callbacks = () => fake.chatSessions[0].callbacks;

    act(() => {
      callbacks().onSnapshot(snapshotFrame([userMessage("u1", "hello")]));
    });
    act(() => {
      callbacks().onMessageAccepted({ message: userMessage("u1", "hello") } as unknown as never);
    });

    expect(result.current.transcriptMessages).toHaveLength(1);
  });
});

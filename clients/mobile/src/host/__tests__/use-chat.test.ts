// @vitest-environment jsdom
/**
 * Sprint 2 must-fix #3: the live overlay (accepted user rows + accumulated
 * blocks) must never survive alongside a fresh snapshot that already
 * contains the now-persisted turn — a duplicated transcript on turn
 * completion is a real §4 fidelity bug, not cosmetic.
 */
import { describe, expect, it, vi } from "vitest";
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

describe("useChat — optimistic send + reconcile-not-replay retry (batch 1 #4/#5)", () => {
  it("sendMessage appends optimistically as pending, and the real messageAccepted confirms it without duplicating", () => {
    const fake = createFakeStreamConnection();
    const { result } = renderHook(() => useChat(fake.connection, "e1", "c1", "u1"));
    const session = () => fake.chatSessions[0];

    act(() => {
      session().callbacks.onSnapshot(snapshotFrame([]));
    });

    act(() => {
      result.current.sendMessage({
        text: "hello from the composer",
        settings: { harnessId: "claude", model: "m", permissionMode: "supervised", reasoningEffort: null, serviceTier: null, agentMode: "regular", profileId: null } as unknown as never,
      });
    });

    expect(result.current.transcriptMessages).toHaveLength(1);
    const sentFrame = session().sendAction.mock.calls[0][0] as { messageId: string };
    expect(result.current.sendStatusFor(sentFrame.messageId)).toBe("pending");

    // The real ack — same messageId — confirms delivery without a duplicate.
    act(() => {
      session().callbacks.onMessageAccepted({
        message: userMessage(sentFrame.messageId, "hello from the composer"),
      } as unknown as never);
    });

    expect(result.current.transcriptMessages).toHaveLength(1);
    expect(result.current.sendStatusFor(sentFrame.messageId)).toBeUndefined();
  });

  it("preserves a not-yet-confirmed optimistic send across an UNRELATED snapshot (a reconnect), instead of wiping it", () => {
    const fake = createFakeStreamConnection();
    const { result } = renderHook(() => useChat(fake.connection, "e1", "c1", "u1"));
    const session = () => fake.chatSessions[0];

    act(() => {
      session().callbacks.onSnapshot(snapshotFrame([]));
    });
    act(() => {
      result.current.sendMessage({
        text: "still in flight",
        settings: {} as unknown as never,
      });
    });
    const sentFrame = session().sendAction.mock.calls[0][0] as { messageId: string };
    expect(result.current.transcriptMessages).toHaveLength(1);

    // A fresh snapshot arrives (e.g. a reconnect) that does NOT yet know
    // about the send — it must NOT be wiped just because trailingMessages
    // normally resets on every snapshot.
    act(() => {
      session().callbacks.onSnapshot(snapshotFrame([]));
    });

    expect(result.current.transcriptMessages.map((m) => m.messageId)).toEqual([sentFrame.messageId]);
    expect(result.current.sendStatusFor(sentFrame.messageId)).toBe("pending");

    // Once a LATER snapshot actually confirms it, the entry becomes the
    // authoritative one and sendStatus clears — no duplicate.
    act(() => {
      session().callbacks.onSnapshot(snapshotFrame([userMessage(sentFrame.messageId, "still in flight")]));
    });
    expect(result.current.transcriptMessages).toHaveLength(1);
    expect(result.current.sendStatusFor(sentFrame.messageId)).toBeUndefined();
  });

  it("does not mark a send failed while the connection is not live — reschedules instead of firing spuriously", () => {
    vi.useFakeTimers();
    const fake = createFakeStreamConnection();
    const { result } = renderHook(() => useChat(fake.connection, "e1", "c1", "u1"));
    const session = () => fake.chatSessions[0];

    act(() => {
      session().callbacks.onSnapshot(snapshotFrame([]));
    });
    act(() => {
      result.current.sendMessage({ text: "flaky connection", settings: {} as unknown as never });
    });
    const sentFrame = session().sendAction.mock.calls[0][0] as { messageId: string };

    // Connection never reported "open" — still the default "reconnecting".
    act(() => {
      vi.advanceTimersByTime(25_000);
    });
    expect(result.current.sendStatusFor(sentFrame.messageId)).toBe("pending");

    // Now it comes back live — the NEXT scheduled check (already re-armed
    // by the reschedule above) sees "live" and correctly times out.
    act(() => {
      session().connection.applyStatus("open", null);
    });
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(result.current.sendStatusFor(sentFrame.messageId)).toBe("failed");

    vi.useRealTimers();
  });

  it("retrySend re-sends the ORIGINAL frame unchanged (same messageId) and flips back to pending", () => {
    vi.useFakeTimers();
    const fake = createFakeStreamConnection();
    const { result } = renderHook(() => useChat(fake.connection, "e1", "c1", "u1"));
    const session = () => fake.chatSessions[0];

    act(() => {
      session().callbacks.onSnapshot(snapshotFrame([]));
      session().connection.applyStatus("open", null);
    });
    act(() => {
      result.current.sendMessage({ text: "retry me", settings: {} as unknown as never });
    });
    const originalFrame = session().sendAction.mock.calls[0][0] as { messageId: string; clientActionId: string };

    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(result.current.sendStatusFor(originalFrame.messageId)).toBe("failed");

    act(() => {
      result.current.retrySend(originalFrame.messageId);
    });

    expect(result.current.sendStatusFor(originalFrame.messageId)).toBe("pending");
    // Exactly the frame that was already sent — same messageId AND
    // clientActionId — not a freshly minted one. Reusing the id is the
    // entire safety argument for retrying without a host-dedupe guarantee.
    const retryFrame = session().sendAction.mock.calls[1][0] as { messageId: string; clientActionId: string };
    expect(retryFrame.messageId).toBe(originalFrame.messageId);
    expect(retryFrame.clientActionId).toBe(originalFrame.clientActionId);

    vi.useRealTimers();
  });

  it("a manual reply retry after a timeout reuses the SAME clientActionId, not a fresh one", () => {
    vi.useFakeTimers();
    const fake = createFakeStreamConnection();
    const { result } = renderHook(() => useChat(fake.connection, "e1", "c1", "u1"));
    const session = () => fake.chatSessions[0];

    act(() => {
      session().callbacks.onSnapshot(
        snapshotFrame([]),
      );
      session().connection.applyStatus("open", null);
    });

    act(() => {
      result.current.sendReply({ kind: "approval", approvalId: "a1", approved: true });
    });
    const firstFrame = session().sendAction.mock.calls[0][0] as { clientActionId: string };

    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    // User taps Approve again after the timeout surfaced a retry.
    act(() => {
      result.current.sendReply({ kind: "approval", approvalId: "a1", approved: true });
    });
    const retryFrame = session().sendAction.mock.calls[1][0] as { clientActionId: string };
    expect(retryFrame.clientActionId).toBe(firstFrame.clientActionId);

    vi.useRealTimers();
  });
});

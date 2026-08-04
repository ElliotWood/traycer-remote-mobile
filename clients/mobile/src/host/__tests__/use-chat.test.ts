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
import {
  approvalKey,
  REVERT_ALL_SCOPE,
  revertKey,
  useChat,
  type UseChatResult,
} from "@/host/use-chat";

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

/**
 * mobile-approve-reject-no-connectivity-gate — the re-validate-on-submit
 * half. `chat-view.tsx`'s render gate (disable Approve/Reject/Submit-answer
 * while disconnected) is tested at that layer; THIS is the dispatch-layer
 * check that still refuses even when a caller bypassed or never wired that
 * gate — the invariant, not the UI convenience. No `ChatView` is mounted in
 * this describe block at all: `sendReply` is called directly on the hook, so
 * nothing here can pass because a disabled button happened to swallow a click.
 */
describe("useChat — sendReply re-validates the connection at the moment of dispatch", () => {
  it("refuses and reports honestly when the connection is not live, WITHOUT sending a frame", () => {
    const fake = createFakeStreamConnection();
    const { result } = renderHook(() => useChat(fake.connection, "e1", "c1", "u1"));
    const session = () => fake.chatSessions[0];

    act(() => {
      session().callbacks.onSnapshot(snapshotFrame([]));
    });
    // Deliberately NOT calling applyStatus("open", ...) — the connection
    // stays at its real default ("reconnecting"), the same state a tap that
    // beat a genuine reconnect would land in.
    act(() => {
      result.current.sendReply({ kind: "approval", approvalId: "a1", approved: true });
    });

    // The observable that actually matters: nothing reached the wire.
    expect(session().sendAction).not.toHaveBeenCalled();
    // And the user is told the truth — not a silent no-op wearing "Approve".
    expect(result.current.replyStatusFor(approvalKey("a1"))).toEqual({
      phase: "refused",
      message: "Connection isn't live — reconnect and try again.",
    });
  });

  it("still sends once the connection genuinely IS live — the refusal above is connection-specific, not universal", () => {
    // Contrast, per verification-practices #14: without this, the test above
    // could pass against a `sendReply` that refuses EVERYTHING, which would
    // prove nothing about connection-awareness specifically.
    const fake = createFakeStreamConnection();
    const { result } = renderHook(() => useChat(fake.connection, "e1", "c1", "u1"));
    const session = () => fake.chatSessions[0];

    act(() => {
      session().callbacks.onSnapshot(snapshotFrame([]));
      session().connection.applyStatus("open", null);
    });
    act(() => {
      result.current.sendReply({ kind: "approval", approvalId: "a1", approved: true });
    });

    expect(session().sendAction).toHaveBeenCalledTimes(1);
    expect(result.current.replyStatusFor(approvalKey("a1"))?.phase).toBe("submitting");
  });

  it("a decision dispatched with a tap already in flight when the connection drops is refused, not queued", () => {
    // The exact race the render-gate alone cannot close: the connection was
    // live when the button was drawn enabled, and dropped before the tap's
    // handler actually ran. `chat-view.tsx` cannot prevent this — a click
    // event already dispatched by the browser still reaches whatever handler
    // is current when it's processed. This is what still catches it.
    const fake = createFakeStreamConnection();
    const { result } = renderHook(() => useChat(fake.connection, "e1", "c1", "u1"));
    const session = () => fake.chatSessions[0];

    act(() => {
      session().callbacks.onSnapshot(snapshotFrame([]));
      session().connection.applyStatus("open", null);
    });
    // The connection drops BETWEEN the render that drew Approve enabled and
    // the moment the (already-queued) tap actually dispatches.
    act(() => {
      session().connection.applyStatus("closed", null);
    });
    act(() => {
      result.current.sendReply({ kind: "approval", approvalId: "a1", approved: true });
    });

    expect(session().sendAction).not.toHaveBeenCalled();
    expect(result.current.replyStatusFor(approvalKey("a1"))?.phase).toBe("refused");
  });
});

/**
 * M6 — a revert's outcome, which used to be discarded.
 *
 * `revertFileChanges` was dispatched untracked and its pending flag cleared on
 * a 3-second timer, so a REJECTED revert rendered "Undoing…" and then looked
 * exactly like success while the host's own `reason` sat unread on the wire.
 *
 * The snapshot test below is the load-bearing one, and it guards a hazard the
 * obvious implementation walks straight into. `snapshot` prunes the ack index
 * to the pending items the snapshot still lists — correct for approvals and
 * interviews, which ARE items a snapshot enumerates. A revert is not an item;
 * it is an action whose entire lifecycle is dispatch → ack, and no snapshot
 * ever mentions it. Since a successful revert PRODUCES a snapshot, pruning on
 * snapshot would drop the correlation before the ack arrives — in the common
 * case, not a corner one — and the rejection would be silently discarded
 * again, one layer further down.
 */
describe("useChat — revert acks", () => {
  const revertAll = revertKey(REVERT_ALL_SCOPE);

  function dispatchRevert(result: { current: UseChatResult }, key: string): void {
    act(() => {
      result.current.dispatchTrackedAction(key, (base) => ({
        ...base,
        kind: "revertFileChanges",
        fromMessageId: null,
        filePaths: null,
        revertArtifacts: true,
      }) as unknown as never);
    });
  }

  it("marks the revert submitting, and clears it only when the ACK says accepted", () => {
    const fake = createFakeStreamConnection();
    const { result } = renderHook(() => useChat(fake.connection, "e1", "c1", "u1"));
    const session = () => fake.chatSessions[0];
    act(() => {
      session().callbacks.onSnapshot(snapshotFrame([]));
    });

    dispatchRevert(result, revertAll);
    expect(result.current.replyStatusFor(revertAll)?.phase).toBe("submitting");

    const sent = session().sendAction.mock.calls.at(-1)?.[0] as { clientActionId: string };
    act(() => {
      session().callbacks.onActionAck({
        clientActionId: sent.clientActionId,
        status: "accepted",
        reason: null,
      } as unknown as never);
    });
    expect(result.current.replyStatusFor(revertAll)).toBeUndefined();
  });

  it("surfaces a REJECTED revert with the host's own reason instead of looking like success", () => {
    const fake = createFakeStreamConnection();
    const { result } = renderHook(() => useChat(fake.connection, "e1", "c1", "u1"));
    const session = () => fake.chatSessions[0];
    act(() => {
      session().callbacks.onSnapshot(snapshotFrame([]));
    });

    dispatchRevert(result, revertAll);
    const sent = session().sendAction.mock.calls.at(-1)?.[0] as { clientActionId: string };
    act(() => {
      session().callbacks.onActionAck({
        clientActionId: sent.clientActionId,
        status: "rejected",
        reason: "The file changed on disk since the snapshot.",
      } as unknown as never);
    });

    const status = result.current.replyStatusFor(revertAll);
    expect(status?.phase).toBe("rejected");
    // The host's wording, not a generic string: "changed underneath you" and
    // "you do not own this chat" need different actions from the user.
    expect(status).toMatchObject({ message: "The file changed on disk since the snapshot." });
  });

  it("keeps the correlation across a snapshot — a revert's own effect produces one", () => {
    const fake = createFakeStreamConnection();
    const { result } = renderHook(() => useChat(fake.connection, "e1", "c1", "u1"));
    const session = () => fake.chatSessions[0];
    act(() => {
      session().callbacks.onSnapshot(snapshotFrame([]));
    });

    dispatchRevert(result, revertAll);
    const sent = session().sendAction.mock.calls.at(-1)?.[0] as { clientActionId: string };

    // The snapshot lands BEFORE the ack. It lists no pending items, which is
    // exactly what makes the naive prune drop this revert.
    act(() => {
      session().callbacks.onSnapshot(snapshotFrame([]));
    });
    expect(result.current.replyStatusFor(revertAll)?.phase).toBe("submitting");

    act(() => {
      session().callbacks.onActionAck({
        clientActionId: sent.clientActionId,
        status: "rejected",
        reason: "Refused after the snapshot.",
      } as unknown as never);
    });
    expect(result.current.replyStatusFor(revertAll)?.phase).toBe("rejected");
  });

  it("tracks two rows independently — one row's failure is not the other's", () => {
    const fake = createFakeStreamConnection();
    const { result } = renderHook(() => useChat(fake.connection, "e1", "c1", "u1"));
    const session = () => fake.chatSessions[0];
    act(() => {
      session().callbacks.onSnapshot(snapshotFrame([]));
    });

    // Two of the thing being distinguished: with one row, "the failure landed
    // on the right key" is unfalsifiable.
    dispatchRevert(result, revertKey("src/a.ts"));
    const first = session().sendAction.mock.calls.at(-1)?.[0] as { clientActionId: string };
    dispatchRevert(result, revertKey("src/b.ts"));

    act(() => {
      session().callbacks.onActionAck({
        clientActionId: first.clientActionId,
        status: "rejected",
        reason: "a.ts is locked.",
      } as unknown as never);
    });

    expect(result.current.replyStatusFor(revertKey("src/a.ts"))?.phase).toBe("rejected");
    expect(result.current.replyStatusFor(revertKey("src/b.ts"))?.phase).toBe("submitting");
  });

  it("does not leave the control disabled forever when no ack ever arrives", () => {
    vi.useFakeTimers();
    const fake = createFakeStreamConnection();
    const { result } = renderHook(() => useChat(fake.connection, "e1", "c1", "u1"));
    const session = () => fake.chatSessions[0];
    act(() => {
      session().callbacks.onSnapshot(snapshotFrame([]));
      session().connection.applyStatus("open", null);
    });

    dispatchRevert(result, revertAll);
    expect(result.current.replyStatusFor(revertAll)?.phase).toBe("submitting");

    act(() => {
      vi.advanceTimersByTime(25_000);
    });
    // The mirror of the timer bug this replaced: ending "submitting" on a
    // schedule is wrong, but never ending it is a stuck button.
    expect(result.current.replyStatusFor(revertAll)?.phase).toBe("rejected");
    vi.useRealTimers();
  });
});

import { describe, expect, it, vi } from "vitest";
import { ActionTracker, type ChatSnapshotView } from "../action-tracker";
import type { StreamFrameEnvelope } from "@traycer-clients/shared/host-transport/i-stream-session";

function frame(clientActionId: string): StreamFrameEnvelope {
  return {
    kind: "approvalDecision",
    hasBinaryPayload: false,
    clientActionId,
    approvalId: "appr-1",
  };
}

const emptySnapshot: ChatSnapshotView = {
  pendingApprovalIds: new Set(),
  pendingInterviewBlockIds: new Set(),
  messageIds: new Set(),
};

function snapshotWithPendingApproval(id: string): ChatSnapshotView {
  return {
    pendingApprovalIds: new Set([id]),
    pendingInterviewBlockIds: new Set(),
    messageIds: new Set(),
  };
}

describe("ActionTracker", () => {
  it("resolves 'applied' when a matching accepted ack arrives", async () => {
    const sent: StreamFrameEnvelope[] = [];
    const tracker = new ActionTracker({ send: (f) => sent.push(f) });

    const outcome = tracker.issue({
      clientActionId: "a1",
      frame: frame("a1"),
      isSettled: (s) => !s.pendingApprovalIds.has("appr-1"),
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].clientActionId).toBe("a1");

    tracker.handleAck({
      clientActionId: "a1",
      status: "accepted",
      reason: null,
      code: null,
    });
    await expect(outcome).resolves.toEqual({ kind: "applied" });
  });

  it("resolves 'rejected' with reason/code when the host rejects the frame", async () => {
    const tracker = new ActionTracker({ send: () => {} });
    const outcome = tracker.issue({
      clientActionId: "a1",
      frame: frame("a1"),
      isSettled: () => false,
    });
    tracker.handleAck({
      clientActionId: "a1",
      status: "rejected",
      reason: "approval not found",
      code: "NOT_FOUND",
    });
    await expect(outcome).resolves.toEqual({
      kind: "rejected",
      reason: "approval not found",
      code: "NOT_FOUND",
    });
  });

  it("ignores an ack for an unrelated clientActionId", async () => {
    const tracker = new ActionTracker({ send: () => {} });
    const outcome = tracker.issue({
      clientActionId: "a1",
      frame: frame("a1"),
      isSettled: () => false,
    });
    tracker.handleAck({
      clientActionId: "other-id",
      status: "accepted",
      reason: null,
      code: null,
    });

    let settled = false;
    void outcome.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    tracker.handleAck({
      clientActionId: "a1",
      status: "accepted",
      reason: null,
      code: null,
    });
    await expect(outcome).resolves.toEqual({ kind: "applied" });
  });

  it("reconciles to 'applied' via a fresh snapshot when the ack never arrives (reconnect race)", async () => {
    const sent: StreamFrameEnvelope[] = [];
    const tracker = new ActionTracker({ send: (f) => sent.push(f) });
    const outcome = tracker.issue({
      clientActionId: "a1",
      frame: frame("a1"),
      isSettled: (s) => !s.pendingApprovalIds.has("appr-1"),
    });

    // No ack ever arrives - the socket died first. A reconnect happens and
    // the fresh snapshot no longer lists the approval as pending.
    tracker.handleReconnectSnapshot(emptySnapshot);

    await expect(outcome).resolves.toEqual({ kind: "applied" });
    // Reconciled via snapshot, not resent.
    expect(sent).toHaveLength(1);
  });

  it("resends the identical frame when the target is still pending after reconnect, and keeps waiting", async () => {
    const sent: StreamFrameEnvelope[] = [];
    const tracker = new ActionTracker({ send: (f) => sent.push(f) });
    const outcome = tracker.issue({
      clientActionId: "a1",
      frame: frame("a1"),
      isSettled: (s) => !s.pendingApprovalIds.has("appr-1"),
    });

    tracker.handleReconnectSnapshot(snapshotWithPendingApproval("appr-1"));
    expect(sent).toHaveLength(2);
    expect(sent[1].clientActionId).toBe("a1");

    let settled = false;
    void outcome.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    // The resend's ack finally lands.
    tracker.handleAck({
      clientActionId: "a1",
      status: "accepted",
      reason: null,
      code: null,
    });
    await expect(outcome).resolves.toEqual({ kind: "applied" });
  });

  it("fails after exhausting max reconcile attempts instead of retrying forever", async () => {
    const sent: StreamFrameEnvelope[] = [];
    const tracker = new ActionTracker({
      send: (f) => sent.push(f),
      maxReconcileAttempts: 3,
    });
    const outcome = tracker.issue({
      clientActionId: "a1",
      frame: frame("a1"),
      isSettled: () => false,
    });

    tracker.handleReconnectSnapshot(snapshotWithPendingApproval("appr-1"));
    tracker.handleReconnectSnapshot(snapshotWithPendingApproval("appr-1"));
    tracker.handleReconnectSnapshot(snapshotWithPendingApproval("appr-1"));

    const result = await outcome;
    expect(result.kind).toBe("failed");
    // initial send + 2 resends before the 3rd reconcile call gives up
    // (attempts reaches maxReconcileAttempts on the 3rd call and fails
    // instead of sending again).
    expect(sent.length).toBeLessThanOrEqual(3);
  });

  it("never resolves twice even if both an ack and a reconnect reconcile race", async () => {
    const resolveSpy = vi.fn();
    const tracker = new ActionTracker({ send: () => {} });
    const outcome = tracker.issue({
      clientActionId: "a1",
      frame: frame("a1"),
      isSettled: () => true,
    });
    void outcome.then(resolveSpy);

    tracker.handleAck({
      clientActionId: "a1",
      status: "accepted",
      reason: null,
      code: null,
    });
    tracker.handleReconnectSnapshot(emptySnapshot);
    tracker.handleAck({
      clientActionId: "a1",
      status: "rejected",
      reason: "late",
      code: null,
    });

    await outcome;
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy).toHaveBeenCalledWith({ kind: "applied" });
  });

  it("resolves every outstanding action as 'failed' on dispose, never leaving a hang past shutdown", async () => {
    const tracker = new ActionTracker({ send: () => {} });
    const a = tracker.issue({
      clientActionId: "a1",
      frame: frame("a1"),
      isSettled: () => false,
    });
    const b = tracker.issue({
      clientActionId: "a2",
      frame: frame("a2"),
      isSettled: () => false,
    });

    tracker.dispose();

    await expect(a).resolves.toMatchObject({ kind: "failed" });
    await expect(b).resolves.toMatchObject({ kind: "failed" });
  });

  it("rejects issuing a new action after dispose instead of accepting work it can't track", async () => {
    const tracker = new ActionTracker({ send: () => {} });
    tracker.dispose();
    const outcome = await tracker.issue({
      clientActionId: "a1",
      frame: frame("a1"),
      isSettled: () => false,
    });
    expect(outcome.kind).toBe("failed");
  });

  it("rejects a duplicate clientActionId issued while the first is still in flight", async () => {
    const tracker = new ActionTracker({ send: () => {} });
    void tracker.issue({
      clientActionId: "a1",
      frame: frame("a1"),
      isSettled: () => false,
    });
    const second = await tracker.issue({
      clientActionId: "a1",
      frame: frame("a1"),
      isSettled: () => false,
    });
    expect(second.kind).toBe("failed");
    tracker.dispose(); // clears the first entry's still-armed timer
  });

  // The regression this pins: an Evaluator-demonstrated hang against this
  // exact class - `issue()` under a down wire (no ack ever, no reconnect
  // ever) resolved NEVER, because nothing but a timer can end that wait and
  // none existed. `send` here is a no-op, exactly matching what
  // `WsStreamClient.sendClientFrame` already does while `phase !==
  // "subscribed"` - the real-world condition this simulates.
  it("fails within the unconfirmed-timeout window when the wire is down - no ack, no reconnect, ever", async () => {
    vi.useFakeTimers();
    try {
      const tracker = new ActionTracker({
        send: () => {},
        unconfirmedTimeoutMs: 5_000,
      });
      const outcome = tracker.issue({
        clientActionId: "a1",
        frame: frame("a1"),
        isSettled: () => false,
      });

      let settled = false;
      void outcome.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(4_999);
      expect(settled).toBe(false); // still within the window - must not fire early

      await vi.advanceTimersByTimeAsync(2);
      expect(settled).toBe(true);
      await expect(outcome).resolves.toMatchObject({ kind: "failed" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets the unconfirmed-timeout on reconcile progress, so a slow-but-live recovery is not falsely failed", async () => {
    vi.useFakeTimers();
    try {
      const tracker = new ActionTracker({
        send: () => {},
        unconfirmedTimeoutMs: 5_000,
        maxReconcileAttempts: 100,
      });
      const outcome = tracker.issue({
        clientActionId: "a1",
        frame: frame("a1"),
        isSettled: () => false,
      });

      // Three reconnect attempts, each arriving just before the window would
      // have expired - a slow-but-genuinely-recovering connection. None of
      // this should trip the timeout, because each attempt resets it.
      for (let i = 0; i < 3; i += 1) {
        await vi.advanceTimersByTimeAsync(4_500);
        tracker.handleReconnectSnapshot(snapshotWithPendingApproval("appr-1"));
      }

      let settled = false;
      void outcome.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);

      tracker.handleAck({
        clientActionId: "a1",
        status: "accepted",
        reason: null,
        code: null,
      });
      await expect(outcome).resolves.toEqual({ kind: "applied" });
    } finally {
      vi.useRealTimers();
    }
  });
});

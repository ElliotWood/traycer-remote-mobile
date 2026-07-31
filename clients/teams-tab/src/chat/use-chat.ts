/**
 * One `chat.subscribe` carrying BOTH the chat's state and its owner actions.
 *
 * Not two subscriptions. The snapshot that lists pending approvals is the
 * same snapshot that settles them — `ActionTracker` reconciles against it —
 * so splitting reading from acting would mean two sockets disagreeing about
 * which approvals are still open.
 *
 * SETTLEMENT NEVER COMES FROM THE ACK ALONE. The tracker resolves on a
 * correlated ack or the item's absence from a fresh post-reconnect snapshot;
 * a bare `accepted` proves the frame was processed, not that anything
 * changed, because a duplicate approve acks `accepted` too.
 *
 * AND THE FRAME IS NOT SENT AT ALL for a chat on another host — see
 * `./actionability`. Both of the tracker's settle routes report `applied`
 * for a chat this host does not have (the ack path, and the absence path
 * where the pending set is trivially empty), so locality is established here
 * rather than inferred from a response.
 *
 * RETRY PROVENANCE, because whoever debugs a duplicate approve will read this
 * and not the tracker: resending an identical frame across a reconnect was
 * MEASURED safe for `send` and `fileEditApprovalDecision` — both dedupe on
 * `clientActionId` — and is ASSUMED for generic `approvalDecision`, whose
 * dedup was never exercised against a real host.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type {
  ChatApprovalState,
  ChatSubscribeClientFrame,
} from "@traycer/protocol/host/agent/gui/subscribe";
import type { HostStreamConnection } from "@traycer-clients/shared/host-transport/single-host-stream-connection";
import { ActionTracker } from "@traycer-clients/shared/host-client/action-tracker";
import type { ActionPhase } from "./action-state";

export type ChatState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly approvals: readonly ChatApprovalState[];
    }
  | { readonly kind: "error"; readonly detail: string };

export interface ChatController {
  readonly state: ChatState;
  /** Phase per approvalId. Absent means idle. */
  readonly phases: Readonly<Record<string, ActionPhase>>;
  readonly approve: (approvalId: string) => void;
  readonly reject: (approvalId: string, reason: string | null) => void;
}

export function useChat(
  streamConnection: HostStreamConnection | null,
  epicId: string,
  chatId: string,
): ChatController {
  const [state, setState] = useState<ChatState>({ kind: "loading" });
  const [phases, setPhases] = useState<Record<string, ActionPhase>>({});
  const trackerRef = useRef<ActionTracker | null>(null);
  const streamRef = useRef<{ sendAction: (f: ChatSubscribeClientFrame) => void } | null>(null);

  useEffect(() => {
    if (streamConnection === null) {
      setState({
        kind: "error",
        detail: "No Traycer host is configured for this build.",
      });
      return;
    }
    let disposed = false;
    setState({ kind: "loading" });
    setPhases({});

    let pendingIds: ReadonlySet<string> = new Set();

    const tracker = new ActionTracker({
      send: (frame) => {
        streamRef.current?.sendAction(frame as ChatSubscribeClientFrame);
      },
    });
    trackerRef.current = tracker;

    const handle = streamConnection.openChat({
      epicId,
      chatId,
      callbacks: {
        onSnapshot: (frame) => {
          if (disposed) return;
          const approvals = frame.snapshot.pendingApprovals;
          pendingIds = new Set(approvals.map((a) => a.approvalId));
          setState({ kind: "ready", approvals });
          // Reconcile every in-flight action against the FRESH snapshot —
          // this is the route that settles an action whose ack died with a
          // dropped socket.
          // The FULL view: the tracker reconciles interviews and messages
          // against it too, and passing a partial one would silently make
          // those settle checks read an empty set — the exact
          // trivially-absent trap this surface exists to avoid.
          tracker.handleReconnectSnapshot({
            pendingApprovalIds: pendingIds,
            pendingInterviewBlockIds: new Set(
              frame.snapshot.pendingInterviews.map((i) => i.blockId),
            ),
            messageIds: new Set(
              frame.snapshot.chat.messages.map((m) => m.messageId),
            ),
          });
        },
        onActionAck: (frame) => {
          if (disposed) return;
          tracker.handleAck({
            clientActionId: frame.clientActionId,
            status: frame.status,
            reason: frame.reason,
            code: frame.code,
          });
        },
        // Every other frame is a NO-OP here rather than unimplemented: this
        // surface renders pending approvals, and a frame it does not render
        // must not take down the screen. The transcript consumes several of
        // these when it lands.
        onMessageAccepted: () => undefined,
        onQueueChanged: () => undefined,
        onTurnStateChanged: () => undefined,
        onBlockDelta: () => undefined,
        onApprovalRequested: () => undefined,
        onApprovalResolved: () => undefined,
        onFileEditApprovalRequested: () => undefined,
        onFileEditApprovalResolved: () => undefined,
        onInterviewRequested: () => undefined,
        onInterviewAnswered: () => undefined,
        onInterviewErrored: () => undefined,
        onEventAppended: () => undefined,
        onRestoreStarted: () => undefined,
        onRestoreProgress: () => undefined,
        onRestoreCompleted: () => undefined,
        onErrorNotice: () => undefined,
        onWorktreeStateChanged: () => undefined,
        onConnectionStatus: () => undefined,
      },
    });
    streamRef.current = handle.stream;

    return () => {
      disposed = true;
      tracker.dispose();
      handle.stream.close();
      trackerRef.current = null;
      streamRef.current = null;
    };
  }, [streamConnection, epicId, chatId]);

  const runAction = useCallback(
    (
      approvalId: string,
      verb: string,
      decision: { approved: boolean; reason: string | null },
    ) => {
      const tracker = trackerRef.current;
      if (tracker === null) return;
      const clientActionId = uuidv4();
      setPhases((p) => ({ ...p, [approvalId]: { kind: "pending", verb } }));
      void tracker
        .issue({
          clientActionId,
          frame: {
            kind: "approvalDecision",
            hasBinaryPayload: false,
            epicId,
            chatId,
            clientActionId,
            approvalId,
            // `reason` is `optional()` on the wire — an absent key or a
            // string, never an explicit null. The conversion happens at this
            // boundary rather than upstream.
            decision:
              decision.reason === null
                ? { approved: decision.approved }
                : { approved: decision.approved, reason: decision.reason },
          } as ChatSubscribeClientFrame,
          // SETTLED means no longer pending — not "we got an ack".
          isSettled: (view) => !view.pendingApprovalIds.has(approvalId),
        })
        .then((outcome) => {
          setPhases((p) => ({
            ...p,
            [approvalId]:
              outcome.kind === "applied"
                ? { kind: "applied" }
                : outcome.kind === "rejected"
                  ? { kind: "rejected", reason: outcome.reason }
                  : // `failed` is UNCONFIRMED, not "did not apply".
                    { kind: "unconfirmed", reason: outcome.reason },
          }));
        });
    },
    [epicId, chatId],
  );

  return {
    state,
    phases,
    approve: useCallback(
      (id: string) => {
        runAction(id, "Approving", { approved: true, reason: null });
      },
      [runAction],
    ),
    reject: useCallback(
      (id: string, reason: string | null) => {
        runAction(id, "Rejecting", { approved: false, reason });
      },
      [runAction],
    ),
  };
}

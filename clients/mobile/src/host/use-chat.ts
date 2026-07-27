/**
 * Single-chat live state + reply dispatch (T6, Flow 4).
 *
 * Opens ONE `chat.subscribe` for the selected `epicId`/`chatId` (via T3's
 * `HostStreamConnection`), folds its frames into the slice the chat detail
 * renders — `runStatus`, the THREE "waiting on the user" pending arrays, and the
 * chat tree needed to resolve an interview prompt — and exposes a `sendReply`
 * API that dispatches the CORRECT client frame per block kind and tracks the
 * `actionAck` of record (submitting → accepted clears / rejected surfaces).
 *
 * This is NOT a port of gui-app's chat-session store: it seeds from the snapshot
 * and rides the same cheap deltas T5's badge reducer uses
 * (`turnStateChanged` + the three request/resolve pairs), plus `actionAck` for
 * reply confirmation. Interview prompts live in `chat.messages[]` (only the
 * snapshot carries them), so a delta-added interview shows a loading state until
 * a snapshot with its block arrives — never an empty one.
 *
 * Lifecycle mirrors `useEpicDoc`: one session per (connection, epicId, chatId),
 * torn down in the same effect cleanup — a socket can never outlive the view.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { ChatStreamClient } from "@traycer-clients/shared/host-transport/chat-stream-client";
import type { ChatStreamCallbacks } from "@traycer-clients/shared/host-transport/chat-stream-client";
import type {
  ChatApprovalState,
  ChatFileEditApprovalState,
  ChatPendingInterviewState,
  ChatRunStatus,
  ChatSnapshot,
  ChatSubscribeClientFrame,
} from "@traycer/protocol/host/agent/gui/subscribe";
import type { InterviewAnswer } from "@traycer/protocol/persistence/epic/content-blocks";
import type { HostStreamConnection } from "./stream-connection";
import type { StreamConnectionState } from "./stream-connection";
import {
  interviewBlockFor,
  latestActivityText,
  type ChatMessage,
  type InterviewBlock,
} from "./chat-projection";

/**
 * Live reply status for one pending item, keyed by its stable pending key. The
 * `actionAck` frame is the source of truth: an `accepted` ack drops the entry
 * (the block's resolve-delta removes the item itself), a `rejected` ack parks a
 * visible error until the user retries.
 */
export type ReplyStatus =
  | { readonly phase: "submitting" }
  | { readonly phase: "rejected"; readonly message: string };

/** Discriminated reply request — each dispatches its OWN client frame. */
export type SendReplyArg =
  | {
      readonly kind: "approval";
      readonly approvalId: string;
      readonly approved: boolean;
      readonly reason?: string;
    }
  | {
      readonly kind: "fileEditApproval";
      readonly approvalId: string;
      readonly approved: boolean;
      readonly reason?: string;
    }
  | {
      readonly kind: "interview";
      readonly blockId: string;
      readonly answers: readonly InterviewAnswer[];
    };

export interface UseChatResult {
  readonly connection: StreamConnectionState;
  readonly runStatus: ChatRunStatus;
  readonly title: string;
  /** A short line of recent context (the latest assistant text), or "". */
  readonly recentActivity: string;
  readonly pendingApprovals: readonly ChatApprovalState[];
  readonly pendingFileEditApprovals: readonly ChatFileEditApprovalState[];
  readonly pendingInterviews: readonly ChatPendingInterviewState[];
  /** Resolves a pending interview's prompt block from the chat tree, or null. */
  readonly resolveInterview: (blockId: string) => InterviewBlock | null;
  /** Live reply status for a pending key (see the `*Key` helpers), or undefined. */
  readonly replyStatusFor: (key: string) => ReplyStatus | undefined;
  readonly sendReply: (arg: SendReplyArg) => void;
}

// Stable pending keys. Tool- and file-edit approvalIds share a namespace on the
// host, so the kind is prefixed to keep their reply status distinct.
export const approvalKey = (approvalId: string): string => `approval:${approvalId}`;
export const fileEditKey = (approvalId: string): string => `fileEdit:${approvalId}`;
export const interviewKey = (blockId: string): string => `interview:${blockId}`;

interface ChatState {
  readonly runStatus: ChatRunStatus;
  readonly title: string;
  readonly messages: readonly ChatMessage[];
  readonly pendingApprovals: readonly ChatApprovalState[];
  readonly pendingFileEditApprovals: readonly ChatFileEditApprovalState[];
  readonly pendingInterviews: readonly ChatPendingInterviewState[];
  readonly replies: Readonly<Record<string, ReplyStatus>>;
  // clientActionId → pending key, so an `actionAck` can find the item it acks.
  readonly ackIndex: Readonly<Record<string, string>>;
}

const INITIAL_STATE: ChatState = {
  runStatus: "idle",
  title: "",
  messages: [],
  pendingApprovals: [],
  pendingFileEditApprovals: [],
  pendingInterviews: [],
  replies: {},
  ackIndex: {},
};

type ChatEvent =
  | { readonly type: "reset" }
  | { readonly type: "snapshot"; readonly snapshot: ChatSnapshot }
  | { readonly type: "turnState"; readonly runStatus: ChatRunStatus }
  | { readonly type: "approvalRequested"; readonly approval: ChatApprovalState }
  | { readonly type: "approvalResolved"; readonly approvalId: string }
  | {
      readonly type: "fileEditApprovalRequested";
      readonly approval: ChatFileEditApprovalState;
    }
  | { readonly type: "fileEditApprovalResolved"; readonly approvalId: string }
  | {
      readonly type: "interviewRequested";
      readonly blockId: string;
      readonly requestedAt: number;
    }
  | { readonly type: "interviewResolved"; readonly blockId: string }
  | {
      readonly type: "replySubmitting";
      readonly key: string;
      readonly clientActionId: string;
    }
  | {
      readonly type: "actionAck";
      readonly clientActionId: string;
      readonly status: "accepted" | "rejected";
      readonly reason: string | null;
    };

/** Drops a keyed entry from a record without mutating the input. */
function without<V>(
  source: Readonly<Record<string, V>>,
  key: string,
): Record<string, V> {
  if (!Object.hasOwn(source, key)) return { ...source };
  const next = { ...source };
  delete next[key];
  return next;
}

function chatReducer(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case "reset":
      return INITIAL_STATE;
    case "snapshot": {
      const snap = event.snapshot;
      // Snapshot is authoritative for pending items. Keep only reply entries
      // whose pending key still exists (a still-blocked item keeps its
      // submitting/rejected status; an accepted item is gone, so its reply
      // clears), and prune the ack index to the surviving keys.
      const liveKeys = new Set<string>([
        ...snap.pendingApprovals.map((a) => approvalKey(a.approvalId)),
        ...snap.pendingFileEditApprovals.map((a) => fileEditKey(a.approvalId)),
        ...snap.pendingInterviews.map((i) => interviewKey(i.blockId)),
      ]);
      const replies: Record<string, ReplyStatus> = {};
      for (const [key, status] of Object.entries(state.replies)) {
        if (liveKeys.has(key)) replies[key] = status;
      }
      const ackIndex: Record<string, string> = {};
      for (const [id, key] of Object.entries(state.ackIndex)) {
        if (liveKeys.has(key)) ackIndex[id] = key;
      }
      return {
        runStatus: snap.runStatus,
        title: snap.chat.title,
        messages: snap.chat.messages,
        pendingApprovals: snap.pendingApprovals,
        pendingFileEditApprovals: snap.pendingFileEditApprovals,
        pendingInterviews: snap.pendingInterviews,
        replies,
        ackIndex,
      };
    }
    case "turnState":
      return { ...state, runStatus: event.runStatus };
    case "approvalRequested": {
      if (
        state.pendingApprovals.some(
          (a) => a.approvalId === event.approval.approvalId,
        )
      ) {
        return state;
      }
      return {
        ...state,
        pendingApprovals: [...state.pendingApprovals, event.approval],
      };
    }
    case "approvalResolved":
      return {
        ...state,
        pendingApprovals: state.pendingApprovals.filter(
          (a) => a.approvalId !== event.approvalId,
        ),
        replies: without(state.replies, approvalKey(event.approvalId)),
      };
    case "fileEditApprovalRequested": {
      if (
        state.pendingFileEditApprovals.some(
          (a) => a.approvalId === event.approval.approvalId,
        )
      ) {
        return state;
      }
      return {
        ...state,
        pendingFileEditApprovals: [
          ...state.pendingFileEditApprovals,
          event.approval,
        ],
      };
    }
    case "fileEditApprovalResolved":
      return {
        ...state,
        pendingFileEditApprovals: state.pendingFileEditApprovals.filter(
          (a) => a.approvalId !== event.approvalId,
        ),
        replies: without(state.replies, fileEditKey(event.approvalId)),
      };
    case "interviewRequested": {
      if (state.pendingInterviews.some((i) => i.blockId === event.blockId)) {
        return state;
      }
      return {
        ...state,
        pendingInterviews: [
          ...state.pendingInterviews,
          { blockId: event.blockId, requestedAt: event.requestedAt },
        ],
      };
    }
    case "interviewResolved":
      return {
        ...state,
        pendingInterviews: state.pendingInterviews.filter(
          (i) => i.blockId !== event.blockId,
        ),
        replies: without(state.replies, interviewKey(event.blockId)),
      };
    case "replySubmitting":
      return {
        ...state,
        replies: { ...state.replies, [event.key]: { phase: "submitting" } },
        ackIndex: { ...state.ackIndex, [event.clientActionId]: event.key },
      };
    case "actionAck": {
      const key = state.ackIndex[event.clientActionId];
      if (key === undefined) return state;
      const ackIndex = without(state.ackIndex, event.clientActionId);
      if (event.status === "accepted") {
        // The block's resolve-delta removes the pending item; clear the reply.
        return { ...state, ackIndex, replies: without(state.replies, key) };
      }
      return {
        ...state,
        ackIndex,
        replies: {
          ...state.replies,
          [key]: {
            phase: "rejected",
            message: event.reason ?? "The host rejected this reply.",
          },
        },
      };
    }
  }
}

/**
 * Builds the chat-stream callbacks that fold frames into the reducer. Only the
 * run/blocked/reply-bearing frames drive state; the rest (block deltas, restore
 * progress, queue, worktree, etc.) are intentionally inert for the phone's
 * reply surface, exactly as T5's badge reducer ignores them.
 */
function makeChatCallbacks(dispatch: (event: ChatEvent) => void): ChatStreamCallbacks {
  return {
    onSnapshot: (frame) => dispatch({ type: "snapshot", snapshot: frame.snapshot }),
    onTurnStateChanged: (frame) =>
      dispatch({ type: "turnState", runStatus: frame.runStatus }),
    onApprovalRequested: (frame) =>
      dispatch({ type: "approvalRequested", approval: frame.approval }),
    onApprovalResolved: (frame) =>
      dispatch({ type: "approvalResolved", approvalId: frame.approvalId }),
    onFileEditApprovalRequested: (frame) =>
      dispatch({ type: "fileEditApprovalRequested", approval: frame.approval }),
    onFileEditApprovalResolved: (frame) =>
      dispatch({ type: "fileEditApprovalResolved", approvalId: frame.approvalId }),
    onInterviewRequested: (frame) =>
      dispatch({
        type: "interviewRequested",
        blockId: frame.blockId,
        requestedAt: frame.requestedAt,
      }),
    onInterviewAnswered: (frame) =>
      dispatch({ type: "interviewResolved", blockId: frame.blockId }),
    onInterviewErrored: (frame) =>
      dispatch({ type: "interviewResolved", blockId: frame.blockId }),
    onActionAck: (frame) =>
      dispatch({
        type: "actionAck",
        clientActionId: frame.clientActionId,
        status: frame.status,
        reason: frame.reason,
      }),
    // Frames the reply surface does not consume.
    onMessageAccepted: () => {},
    onQueueChanged: () => {},
    onBlockDelta: () => {},
    onEventAppended: () => {},
    onRestoreStarted: () => {},
    onRestoreProgress: () => {},
    onRestoreCompleted: () => {},
    onErrorNotice: () => {},
    onWorktreeStateChanged: () => {},
    onConnectionStatus: () => {},
  };
}

/**
 * Subscribes a component to one chat's live reply state.
 *
 * A `null` connection (no host) yields the idle initial state in the
 * "disconnected" state without opening anything. Otherwise one `chat.subscribe`
 * session is opened per (connection, epicId, chatId); its close spy runs on
 * unmount or an id change.
 */
export function useChat(
  streamConnection: HostStreamConnection | null,
  epicId: string,
  chatId: string,
): UseChatResult {
  const [state, dispatch] = useReducer(chatReducer, INITIAL_STATE);
  const [connection, setConnection] =
    useState<StreamConnectionState>("reconnecting");
  const streamRef = useRef<ChatStreamClient | null>(null);

  useEffect(() => {
    if (streamConnection === null) {
      setConnection("disconnected");
      return;
    }
    // Reset to the idle baseline whenever the target chat changes so a previous
    // chat's pending items can never bleed into the new one.
    dispatch({ type: "reset" });

    const handle = streamConnection.openChat({
      epicId,
      chatId,
      callbacks: makeChatCallbacks(dispatch),
    });
    streamRef.current = handle.stream;

    setConnection(handle.connection.getState());
    const unsubscribe = handle.connection.subscribe(() => {
      setConnection(handle.connection.getState());
    });

    return () => {
      unsubscribe();
      handle.stream.close();
      streamRef.current = null;
    };
  }, [streamConnection, epicId, chatId]);

  const sendReply = useCallback(
    (arg: SendReplyArg): void => {
      const stream = streamRef.current;
      if (stream === null) return;
      const clientActionId = uuidv4();
      const base = {
        hasBinaryPayload: false as const,
        epicId,
        chatId,
        clientActionId,
      };
      let frame: ChatSubscribeClientFrame;
      let key: string;
      switch (arg.kind) {
        case "approval":
          frame = {
            ...base,
            kind: "approvalDecision",
            approvalId: arg.approvalId,
            decision: { approved: arg.approved, reason: arg.reason },
          };
          key = approvalKey(arg.approvalId);
          break;
        case "fileEditApproval":
          frame = {
            ...base,
            kind: "fileEditApprovalDecision",
            approvalId: arg.approvalId,
            decision: { approved: arg.approved, reason: arg.reason },
          };
          key = fileEditKey(arg.approvalId);
          break;
        case "interview":
          frame = {
            ...base,
            kind: "interviewAnswer",
            blockId: arg.blockId,
            answers: [...arg.answers],
          };
          key = interviewKey(arg.blockId);
          break;
      }
      dispatch({ type: "replySubmitting", key, clientActionId });
      stream.sendAction(frame);
    },
    [epicId, chatId],
  );

  const resolveInterview = useCallback(
    (blockId: string): InterviewBlock | null =>
      interviewBlockFor(state.messages, blockId),
    [state.messages],
  );

  const replyStatusFor = useCallback(
    (key: string): ReplyStatus | undefined => state.replies[key],
    [state.replies],
  );

  return {
    connection,
    runStatus: state.runStatus,
    title: state.title,
    recentActivity: latestActivityText(state.messages),
    pendingApprovals: state.pendingApprovals,
    pendingFileEditApprovals: state.pendingFileEditApprovals,
    pendingInterviews: state.pendingInterviews,
    resolveInterview,
    replyStatusFor,
    sendReply,
  };
}

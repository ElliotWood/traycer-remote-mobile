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
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { DEFAULT_ACCOUNT_CONTEXT } from "@traycer/protocol/common/schemas";
import type { ChatStreamClient } from "@traycer-clients/shared/host-transport/chat-stream-client";
import type { ChatStreamCallbacks } from "@traycer-clients/shared/host-transport/chat-stream-client";
import type {
  BackgroundItem,
  ChatAccumulatedFileChange,
  ChatActiveTurn,
  ChatApprovalState,
  ChatFileEditApprovalState,
  ChatPendingInterviewState,
  ChatQueueState,
  ChatRunStatus,
  ChatSnapshot,
  ChatSubscribeClientFrame,
} from "@traycer/protocol/host/agent/gui/subscribe";
import type { ChatRunSettings } from "@traycer/protocol/persistence/epic/foundation";
import type { WorktreeBinding } from "@traycer/protocol/host/worktree-schemas";
import type { RuntimeEvent } from "@traycer/protocol/host/agent/gui/agent-runtime";
import type {
  ContentBlock,
  InterviewAnswer,
} from "@traycer/protocol/persistence/epic/content-blocks";
import { CACHE_SCHEMA_VERSION } from "./cache-config";
import {
  messageContentWithAttachments,
  rememberSentAttachments,
  stripAttachmentPayloads,
  type PreparedAttachment,
} from "./image-attachment";
import type { HostStreamConnection } from "./stream-connection";
import type { StreamConnectionState } from "./stream-connection";
import { startLivenessRecovery } from "./liveness-recovery";
import {
  interviewBlockFor,
  latestActivityText,
  type ChatMessage,
  type InterviewBlock,
} from "./chat-projection";
import {
  EMPTY_LIVE_TURN,
  foldRuntimeEvent,
  liveTurnBlocks as computeLiveTurnBlocks,
  type LiveTurnState,
} from "./chat-live-turn";
import { plainTextContent } from "./use-create-chat";

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

/** P2 composer send: plain-text instruction + the explicit settings the composer's toggles resolved (harness/model/permission mode/agent mode). */
export interface SendMessageArgs {
  readonly text: string;
  readonly settings: ChatRunSettings;
  /** Attachments — already downscaled/base64-encoded by `prepareImageAttachment` (image-attachment.ts). Empty by default. */
  readonly attachments?: readonly PreparedAttachment[];
}

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
  /** Snapshot messages + any user rows accepted since (Sprint 2 transcript). */
  readonly transcriptMessages: readonly ChatMessage[];
  /** The current in-progress turn's blocks, folded live from `blockDelta` (Sprint 2). */
  readonly liveTurnBlocks: readonly ContentBlock[];
  /** P2: queued messages (pause/resume/edit/steer surface). */
  readonly queue: ChatQueueState;
  /**
   * P2: in-flight background work (backgrounded subagents/`run_in_background`
   * commands/Monitors). `undefined` is the host-capability sentinel — no
   * frame has ever advertised background items for this host/session, so
   * the lower dock's Background section should be hidden entirely, not
   * shown empty (mirrors the wire's own OPTIONAL-on-purpose convention).
   */
  readonly backgroundItems: readonly BackgroundItem[] | undefined;
  /** P2: cumulative file changes for the whole chat — the lower dock's accumulated-changes panel. Refreshed on snapshot; may lag slightly mid-turn (no dedicated delta frame exists for it). */
  readonly accumulatedFileChanges: readonly ChatAccumulatedFileChange[];
  /** P2: the current turn's live record (status/model/harness/startedAt), or `null` between turns — drives the run indicator + elapsed footer. */
  readonly activeTurn: ChatActiveTurn | null;
  /** P2: authoritative "is there a turn to stop right now" — narrower than `runStatus !== "idle"`. `undefined` on an older host; callers fall back to `runStatus`. */
  readonly turnInProgress: boolean | undefined;
  readonly accessRole: "owner" | "viewer";
  /** The chat's persisted default run settings (harness/model/permission mode/agent mode), or `null` if never set — seeds the composer's pickers. */
  readonly chatSettings: ChatRunSettings | null;
  /** Current worktree binding (read-only branch/workspace chip) — `null` before the first snapshot. */
  readonly worktreeBinding: WorktreeBinding | null;
  readonly missingWorktreePaths: readonly string[];
  /** Sends a new user message with explicit settings (the composer's model/permission/agent-mode toggles) — P2's `send` client frame. */
  readonly sendMessage: (args: SendMessageArgs) => void;
  /** Stops the active turn (P2's `stop` client frame). No-ops if there is nothing to stop. */
  readonly stopTurn: () => void;
  /** Builds and sends any other client frame (queue actions, background-item stops, revert-file-changes) with `epicId`/`chatId`/`clientActionId` already filled in. No-ops if disconnected. */
  readonly dispatchAction: (
    build: (base: {
      readonly hasBinaryPayload: false;
      readonly epicId: string;
      readonly chatId: string;
      readonly clientActionId: string;
    }) => ChatSubscribeClientFrame,
  ) => void;
  /**
   * True once the first `snapshot` frame has landed for this (epicId, chatId).
   * S5 (C, F1 fix): distinguishes "not yet observed" from "observed and
   * unblocked" — `INITIAL_STATE` has `pendingApprovals: []` etc. BEFORE any
   * snapshot arrives, so a naive `blocked` boolean can't tell those apart on
   * its own. Consumers doing blocked-transition detection must gate on this
   * (see `notifications.ts`'s `detectBlockedTransitions`) or an already-blocked
   * chat's first snapshot reads as a false→true flip and fires a spurious
   * notification.
   */
  readonly hasSnapshot: boolean;
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
  // User rows accepted (`onMessageAccepted`) SINCE the last snapshot — the
  // snapshot itself is always authoritative; this + `liveTurn` reset to empty
  // on every fresh snapshot so nothing from a stale overlay can survive
  // alongside the now-persisted content (no-duplication guarantee).
  readonly trailingMessages: readonly ChatMessage[];
  readonly liveTurn: LiveTurnState;
  readonly pendingApprovals: readonly ChatApprovalState[];
  readonly pendingFileEditApprovals: readonly ChatFileEditApprovalState[];
  readonly pendingInterviews: readonly ChatPendingInterviewState[];
  readonly replies: Readonly<Record<string, ReplyStatus>>;
  // clientActionId → pending key, so an `actionAck` can find the item it acks.
  readonly ackIndex: Readonly<Record<string, string>>;
  /** S5 (C, F1 fix): true once the first `snapshot` frame has landed. */
  readonly hasSnapshot: boolean;
  // P2 additions — all sourced from fields the wire already carries.
  readonly queue: ChatQueueState;
  readonly backgroundItems: readonly BackgroundItem[] | undefined;
  readonly accumulatedFileChanges: readonly ChatAccumulatedFileChange[];
  readonly activeTurn: ChatActiveTurn | null;
  readonly turnInProgress: boolean | undefined;
  readonly accessRole: "owner" | "viewer";
  readonly chatSettings: ChatRunSettings | null;
  readonly worktreeBinding: WorktreeBinding | null;
  readonly missingWorktreePaths: readonly string[];
}

const INITIAL_QUEUE: ChatQueueState = { status: "idle", items: [] };

const INITIAL_STATE: ChatState = {
  runStatus: "idle",
  title: "",
  messages: [],
  trailingMessages: [],
  liveTurn: EMPTY_LIVE_TURN,
  pendingApprovals: [],
  pendingFileEditApprovals: [],
  pendingInterviews: [],
  replies: {},
  ackIndex: {},
  hasSnapshot: false,
  queue: INITIAL_QUEUE,
  backgroundItems: undefined,
  accumulatedFileChanges: [],
  activeTurn: null,
  turnInProgress: undefined,
  accessRole: "owner",
  chatSettings: null,
  worktreeBinding: null,
  missingWorktreePaths: [],
};

/**
 * P0 caching, layer C: the persisted slice of `ChatState`. Deliberately NOT
 * the whole state — `trailingMessages`/`liveTurn`/`replies`/`ackIndex` are
 * session-only (resurrecting a stale "submitting" reply or a partial live
 * turn across a reload would be a correctness bug, not a feature). `messages`
 * here is the RENDERED transcript (`state.messages` + `state.trailingMessages`
 * combined, exactly what `transcriptMessages` exposes today) so a cached
 * reload shows the same thing the user last saw, capped to the most recent
 * `CHAT_CACHE_MAX_MESSAGES` — this is a last-known PREVIEW; the next real
 * snapshot is always fully authoritative and replaces it wholesale.
 */
interface ChatCacheSlice {
  readonly title: string;
  readonly messages: readonly ChatMessage[];
  readonly runStatus: ChatRunStatus;
  readonly pendingApprovals: readonly ChatApprovalState[];
  readonly pendingFileEditApprovals: readonly ChatFileEditApprovalState[];
  readonly pendingInterviews: readonly ChatPendingInterviewState[];
}

const CHAT_CACHE_MAX_MESSAGES = 50;

export function chatCacheStorageKey(epicId: string, chatId: string): string {
  return `chat-cache:v${CACHE_SCHEMA_VERSION}:${epicId}:${chatId}`;
}

/**
 * A phone attachment's base64 (downscaled, but still real bytes — see
 * `image-attachment.ts`'s docblock) must never land in localStorage: a
 * single cached photo could blow the ~5-10MB quota this whole cache layer
 * shares with the epic-tree projection seed and TanStack's persisted
 * queries, throwing `QuotaExceededError` and regressing the instant-paint
 * win. Only user-role messages can carry an `imageAttachment` node.
 */
function stripAttachmentsForCache(message: ChatMessage): ChatMessage {
  if (message.role !== "user") return message;
  return { ...message, message: { ...message.message, content: stripAttachmentPayloads(message.message.content) } };
}

/** Pure serialize, kept separate from storage I/O for testability. */
export function serializeChatCache(state: ChatState): string {
  const allMessages = [...state.messages, ...state.trailingMessages];
  const slice: ChatCacheSlice = {
    title: state.title,
    messages: allMessages
      .slice(Math.max(0, allMessages.length - CHAT_CACHE_MAX_MESSAGES))
      .map(stripAttachmentsForCache),
    runStatus: state.runStatus,
    pendingApprovals: state.pendingApprovals,
    pendingFileEditApprovals: state.pendingFileEditApprovals,
    pendingInterviews: state.pendingInterviews,
  };
  return JSON.stringify(slice);
}

function parseChatCache(raw: string): ChatCacheSlice | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { title?: unknown }).title !== "string" ||
      !Array.isArray((parsed as { messages?: unknown }).messages) ||
      !Array.isArray((parsed as { pendingApprovals?: unknown }).pendingApprovals) ||
      !Array.isArray((parsed as { pendingFileEditApprovals?: unknown }).pendingFileEditApprovals) ||
      !Array.isArray((parsed as { pendingInterviews?: unknown }).pendingInterviews)
    ) {
      return null;
    }
    return parsed as ChatCacheSlice;
  } catch {
    return null;
  }
}

/**
 * Synchronous localStorage read, used both as `useReducer`'s lazy 3rd-arg
 * initializer (covers the mount case with zero gap — `localStorage.getItem`
 * is synchronous, unlike TanStack's `await`-based restore or IndexedDB) and
 * from the effect's "reset" dispatch (see `useChat` — that dispatch fires on
 * EVERY effect run, including the first, so it must seed from cache too or
 * it would blank the lazy-initialized state a moment after mount).
 */
export function readCachedChatState(epicId: string, chatId: string): ChatCacheSlice | null {
  if (typeof window === "undefined" || !("localStorage" in window)) return null;
  try {
    const raw = window.localStorage.getItem(chatCacheStorageKey(epicId, chatId));
    return raw === null ? null : parseChatCache(raw);
  } catch {
    return null;
  }
}

function writeCachedChatState(epicId: string, chatId: string, serialized: string): void {
  if (typeof window === "undefined" || !("localStorage" in window)) return;
  try {
    window.localStorage.setItem(chatCacheStorageKey(epicId, chatId), serialized);
  } catch {
    // Quota exceeded / private-mode write rejection — degrade to "no cache
    // written this time", never throw.
  }
}

/**
 * `hasSnapshot` stays `false` for a cache-seeded state — it is cached, not
 * live-confirmed, and `notifications.ts`'s blocked-transition gate relies on
 * that distinction to avoid firing a spurious notification on a state it has
 * never actually observed live.
 */
function seedFromCache(cached: ChatCacheSlice | null): ChatState {
  if (cached === null) return INITIAL_STATE;
  return {
    ...INITIAL_STATE,
    title: cached.title,
    messages: cached.messages,
    runStatus: cached.runStatus,
    pendingApprovals: cached.pendingApprovals,
    pendingFileEditApprovals: cached.pendingFileEditApprovals,
    pendingInterviews: cached.pendingInterviews,
  };
}

type ChatEvent =
  | { readonly type: "reset"; readonly cached: ChatCacheSlice | null }
  | { readonly type: "snapshot"; readonly snapshot: ChatSnapshot }
  | {
      readonly type: "turnState";
      readonly runStatus: ChatRunStatus;
      readonly activeTurn: ChatActiveTurn | null;
      readonly backgroundItems: readonly BackgroundItem[] | undefined;
      readonly turnInProgress: boolean | undefined;
    }
  | { readonly type: "queueChanged"; readonly queue: ChatQueueState }
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
    }
  | { readonly type: "messageAccepted"; readonly message: ChatMessage }
  | { readonly type: "blockDelta"; readonly event: RuntimeEvent };

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
      return seedFromCache(event.cached);
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
        // The snapshot is always fully authoritative — both overlays reset
        // to empty BEFORE its content becomes the render source, so nothing
        // from a stale live turn can survive alongside it (no-duplication
        // guarantee; see `use-chat.test.ts`'s snapshot-transition test).
        trailingMessages: [],
        liveTurn: EMPTY_LIVE_TURN,
        pendingApprovals: snap.pendingApprovals,
        pendingFileEditApprovals: snap.pendingFileEditApprovals,
        pendingInterviews: snap.pendingInterviews,
        replies,
        ackIndex,
        hasSnapshot: true,
        queue: snap.queue,
        backgroundItems: snap.backgroundItems,
        accumulatedFileChanges: snap.accumulatedFileChanges,
        activeTurn: snap.activeTurn,
        turnInProgress: snap.turnInProgress,
        accessRole: snap.access.role,
        chatSettings: snap.chat.settings,
        worktreeBinding: snap.worktreeBinding,
        missingWorktreePaths: snap.missingWorktreePaths,
      };
    }
    case "turnState":
      return {
        ...state,
        runStatus: event.runStatus,
        activeTurn: event.activeTurn,
        backgroundItems: event.backgroundItems,
        turnInProgress: event.turnInProgress,
      };
    case "queueChanged":
      return { ...state, queue: event.queue };
    case "messageAccepted": {
      const alreadyKnown =
        state.messages.some((m) => m.messageId === event.message.messageId) ||
        state.trailingMessages.some((m) => m.messageId === event.message.messageId);
      if (alreadyKnown) return state;
      return {
        ...state,
        trailingMessages: [...state.trailingMessages, event.message],
        liveTurn: EMPTY_LIVE_TURN,
      };
    }
    case "blockDelta":
      return { ...state, liveTurn: foldRuntimeEvent(state.liveTurn, event.event) };
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
 * Builds the chat-stream callbacks that fold frames into the reducer. The
 * run/blocked/reply-bearing frames drive the T6 reply surface; `messageAccepted`
 * and `blockDelta` (Sprint 2) drive the transcript; `turnStateChanged` (P2)
 * also carries `activeTurn`/`backgroundItems`/`turnInProgress` for the run
 * indicator + lower dock. The rest (restore progress, worktree, etc.) remain
 * intentionally inert.
 */
function makeChatCallbacks(dispatch: (event: ChatEvent) => void): ChatStreamCallbacks {
  return {
    onSnapshot: (frame) => dispatch({ type: "snapshot", snapshot: frame.snapshot }),
    onTurnStateChanged: (frame) =>
      dispatch({
        type: "turnState",
        runStatus: frame.runStatus,
        activeTurn: frame.activeTurn,
        backgroundItems: frame.backgroundItems,
        turnInProgress: frame.turnInProgress,
      }),
    onQueueChanged: (frame) => dispatch({ type: "queueChanged", queue: frame.queue }),
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
    onMessageAccepted: (frame) => dispatch({ type: "messageAccepted", message: frame.message }),
    onBlockDelta: (frame) => dispatch({ type: "blockDelta", event: frame.event }),
    // A DIFFERENT durable timeline log (turn/queue/approval state
    // transitions), not content-block deltas — see `chat-live-turn.ts`'s
    // docblock. Not consumed by the transcript.
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
 *
 * `userId` (P2): needed only for `sendMessage`'s `sender` field — a `null`
 * userId (signed out) makes `sendMessage` a no-op rather than throwing;
 * every read-only capability here (transcript, badges, replies) works
 * without it, matching `useCreateChat`'s same signed-out handling.
 */
export function useChat(
  streamConnection: HostStreamConnection | null,
  epicId: string,
  chatId: string,
  userId: string | null,
): UseChatResult {
  // P0 caching: the lazy 3rd-arg initializer reads localStorage
  // SYNCHRONOUSLY on first render (unlike TanStack's `await`-based restore
  // or IndexedDB), so a warm mount's very first paint already shows the
  // last-known transcript. Safe as a lazy initializer (not re-read on every
  // render) because every chat open is a fresh mount of this hook
  // (`app-shell.tsx`'s route switch never transitions chat→chat in place).
  const [state, dispatch] = useReducer(
    chatReducer,
    { epicId, chatId },
    ({ epicId: initialEpicId, chatId: initialChatId }) =>
      seedFromCache(readCachedChatState(initialEpicId, initialChatId)),
  );
  const [connection, setConnection] =
    useState<StreamConnectionState>("reconnecting");
  const streamRef = useRef<ChatStreamClient | null>(null);
  // Dedupes the cache write against a burst of live frames (S1) — only
  // re-serializes/writes when the persisted slice actually changed.
  const lastWrittenChatCacheRef = useRef<string | null>(null);

  useEffect(() => {
    if (streamConnection === null) {
      setConnection("disconnected");
      return;
    }
    // Reset to the cache-seeded baseline (never a hard blank — this line
    // runs on EVERY effect invocation, including the very first, so it must
    // preserve what the lazy initializer above just seeded) whenever the
    // target chat changes, so a previous chat's pending items can never
    // bleed into the new one.
    dispatch({ type: "reset", cached: readCachedChatState(epicId, chatId) });

    const handle = streamConnection.openChat({
      epicId,
      chatId,
      callbacks: makeChatCallbacks(dispatch),
    });
    streamRef.current = handle.stream;

    let currentState = handle.connection.getState();
    setConnection(currentState);
    const unsubscribe = handle.connection.subscribe(() => {
      currentState = handle.connection.getState();
      setConnection(currentState);
    });

    // S5 (A): force a fast reconnect on wake signals instead of waiting out
    // the raw backoff ceiling. One instance per mounted chat view.
    const stopLivenessRecovery = startLivenessRecovery({
      reconnect: (reason) => streamConnection.reconnectAll(reason),
      isLive: () => currentState === "live",
    });

    return () => {
      stopLivenessRecovery();
      unsubscribe();
      handle.stream.close();
      streamRef.current = null;
    };
  }, [streamConnection, epicId, chatId]);

  // P0 caching write-through: only once `hasSnapshot` is true — i.e. only
  // ever persist live-confirmed data, never overwrite a good cache with the
  // still-loading/cache-seeded state a reconnect window can otherwise leave
  // `state` in.
  useEffect(() => {
    if (!state.hasSnapshot) return;
    const serialized = serializeChatCache(state);
    if (serialized === lastWrittenChatCacheRef.current) return;
    lastWrittenChatCacheRef.current = serialized;
    writeCachedChatState(epicId, chatId, serialized);
  }, [state, epicId, chatId]);

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

  const sendMessage = useCallback(
    (args: SendMessageArgs): void => {
      const stream = streamRef.current;
      const text = args.text.trim();
      const attachments = args.attachments ?? [];
      if (stream === null || userId === null || (text.length === 0 && attachments.length === 0)) return;
      // So the sender can still view what they just sent once the host
      // rewrites the persisted b64content to a hash — see the docblock on
      // `rememberSentAttachments`.
      rememberSentAttachments(attachments);
      const frame: ChatSubscribeClientFrame = {
        hasBinaryPayload: false,
        epicId,
        chatId,
        clientActionId: uuidv4(),
        kind: "send",
        messageId: uuidv4(),
        content:
          attachments.length === 0 ? plainTextContent(text) : messageContentWithAttachments(text, attachments),
        sender: { type: "user", userId },
        settings: args.settings,
        accountContext: DEFAULT_ACCOUNT_CONTEXT,
        deliveryPolicy: "auto",
        worktreeIntent: null,
      };
      stream.sendAction(frame);
    },
    [epicId, chatId, userId],
  );

  const stopTurn = useCallback((): void => {
    const stream = streamRef.current;
    if (stream === null) return;
    const frame: ChatSubscribeClientFrame = {
      hasBinaryPayload: false,
      epicId,
      chatId,
      clientActionId: uuidv4(),
      kind: "stop",
      turnId: state.activeTurn?.turnId ?? null,
    };
    stream.sendAction(frame);
  }, [epicId, chatId, state.activeTurn]);

  /**
   * Low-level escape hatch for the lower dock's simpler actions (queue
   * pause/resume/edit/cancel/steer, background-item stop/stop-all,
   * revert-file-changes) — `sendMessage`/`stopTurn` stay dedicated
   * functions since they're the most-used and easiest to get wrong by
   * hand; everything else just needs `epicId`/`chatId`/`clientActionId`
   * filled in, which this does once instead of in every caller.
   */
  const dispatchAction = useCallback(
    (
      build: (base: {
        readonly hasBinaryPayload: false;
        readonly epicId: string;
        readonly chatId: string;
        readonly clientActionId: string;
      }) => ChatSubscribeClientFrame,
    ): void => {
      const stream = streamRef.current;
      if (stream === null) return;
      const base = {
        hasBinaryPayload: false as const,
        epicId,
        chatId,
        clientActionId: uuidv4(),
      };
      stream.sendAction(build(base));
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

  // Perf fix: these were plain expressions below, recomputed to a BRAND NEW
  // array/identity on every render of this hook — including renders caused
  // by state slices that have nothing to do with the transcript (queue,
  // turnInProgress, connection). A consumer that memoizes on these values
  // (`React.memo`, `useMemo`) could never bail out. `state.messages`/
  // `state.trailingMessages`/`state.liveTurn` only change reference when the
  // REDUCER actually touches them (every other case spreads `...state`,
  // preserving the same array/object references) — memoizing on those, not
  // on `state` itself, keeps `transcriptMessages`/`liveTurnBlocks` stable
  // across unrelated dispatches.
  const transcriptMessages = useMemo(
    () => [...state.messages, ...state.trailingMessages],
    [state.messages, state.trailingMessages],
  );
  const liveTurnBlocksMemo = useMemo(
    () => computeLiveTurnBlocks(state.liveTurn),
    [state.liveTurn],
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
    transcriptMessages,
    liveTurnBlocks: liveTurnBlocksMemo,
    hasSnapshot: state.hasSnapshot,
    queue: state.queue,
    backgroundItems: state.backgroundItems,
    accumulatedFileChanges: state.accumulatedFileChanges,
    activeTurn: state.activeTurn,
    turnInProgress: state.turnInProgress,
    accessRole: state.accessRole,
    chatSettings: state.chatSettings,
    worktreeBinding: state.worktreeBinding,
    missingWorktreePaths: state.missingWorktreePaths,
    sendMessage,
    stopTurn,
    dispatchAction,
  };
}

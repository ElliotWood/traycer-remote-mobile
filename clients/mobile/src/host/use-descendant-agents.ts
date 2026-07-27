/**
 * Live running-state + stop capability for a chat's DESCENDANT chats — the
 * data the lower dock's Active-agents panel needs. Mirrors
 * `use-chat-badges.ts`'s exact lifecycle (one bounded `chat.subscribe` per
 * id, all torn down together on unmount/id-set change) but additionally
 * exposes a per-descendant `stop()`, since the badges hook is read-only.
 *
 * Reachability note: desktop's active-agents panel aggregates over the
 * WHOLE epic's descendant tree via an epic-wide, cross-host Yjs
 * presence-awareness store — genuinely unavailable to a single chat
 * screen. This hook gets the SAME end-user-visible result (self + running
 * descendants, with stop) a different way: the caller (`ChatView`) already
 * has access to the epic's chat list via `useCurrentEpicDocOrNull()`
 * (`current-epic-context.tsx`'s shared session), so it can compute this
 * chat's descendant ids locally and open a SMALL number of bounded
 * per-descendant sessions — not epic-wide, not cross-host, just the same
 * proven per-chat-subscribe pattern this codebase already uses everywhere.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { ChatStreamCallbacks } from "@traycer-clients/shared/host-transport/chat-stream-client";
import type { ChatActiveTurn, ChatRunStatus, ChatSubscribeClientFrame } from "@traycer/protocol/host/agent/gui/subscribe";
import type { HostStreamConnection } from "./stream-connection";

export interface DescendantAgentState {
  readonly runStatus: ChatRunStatus;
  readonly activeTurn: ChatActiveTurn | null;
}

export function isDescendantRunning(state: DescendantAgentState | undefined): boolean {
  return state !== undefined && (state.runStatus === "running" || state.runStatus === "stopping");
}

interface DescendantSession {
  close(): void;
  stop(): void;
}

function openDescendantSession(
  streamConnection: HostStreamConnection,
  epicId: string,
  chatId: string,
  onChange: (state: DescendantAgentState) => void,
): DescendantSession {
  let runStatus: ChatRunStatus = "idle";
  let activeTurn: ChatActiveTurn | null = null;
  const emit = (): void => onChange({ runStatus, activeTurn });

  const callbacks: ChatStreamCallbacks = {
    onSnapshot: (frame) => {
      runStatus = frame.snapshot.runStatus;
      activeTurn = frame.snapshot.activeTurn;
      emit();
    },
    onTurnStateChanged: (frame) => {
      runStatus = frame.runStatus;
      activeTurn = frame.activeTurn;
      emit();
    },
    // Only run-state matters for this panel — every other frame is inert.
    onApprovalRequested: () => {},
    onApprovalResolved: () => {},
    onFileEditApprovalRequested: () => {},
    onFileEditApprovalResolved: () => {},
    onInterviewRequested: () => {},
    onInterviewAnswered: () => {},
    onInterviewErrored: () => {},
    onActionAck: () => {},
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

  const handle = streamConnection.openChat({ epicId, chatId, callbacks });
  return {
    close: () => handle.stream.close(),
    stop: () => {
      const frame: ChatSubscribeClientFrame = {
        hasBinaryPayload: false,
        epicId,
        chatId,
        clientActionId: uuidv4(),
        kind: "stop",
        turnId: activeTurn?.turnId ?? null,
      };
      handle.stream.sendAction(frame);
    },
  };
}

const KEY_SEP = " ";

function pickKeys(
  source: Readonly<Record<string, DescendantAgentState>>,
  keep: readonly string[],
): Record<string, DescendantAgentState> {
  const out: Record<string, DescendantAgentState> = {};
  for (const id of keep) {
    if (Object.hasOwn(source, id)) out[id] = source[id];
  }
  return out;
}

export interface UseDescendantAgentsResult {
  /** Keyed by chatId — absent means "no report yet", same convention as `useChatBadges`. */
  readonly states: Readonly<Record<string, DescendantAgentState>>;
  readonly stop: (chatId: string) => void;
}

export function useDescendantAgents(
  streamConnection: HostStreamConnection | null,
  epicId: string,
  chatIds: readonly string[],
): UseDescendantAgentsResult {
  const [states, setStates] = useState<Record<string, DescendantAgentState>>({});
  const chatIdsKey = chatIds.join(KEY_SEP);
  const sessionsRef = useRef<Readonly<Record<string, DescendantSession>>>({});

  useEffect(() => {
    if (streamConnection === null) {
      sessionsRef.current = {};
      return;
    }
    const ids = chatIdsKey === "" ? [] : chatIdsKey.split(KEY_SEP);
    setStates((prev) => pickKeys(prev, ids));

    const sessions: Record<string, DescendantSession> = {};
    for (const chatId of ids) {
      sessions[chatId] = openDescendantSession(streamConnection, epicId, chatId, (state) => {
        setStates((prev) => ({ ...prev, [chatId]: state }));
      });
    }
    sessionsRef.current = sessions;

    return () => {
      for (const session of Object.values(sessions)) session.close();
      sessionsRef.current = {};
    };
  }, [streamConnection, epicId, chatIdsKey]);

  const stop = useCallback((chatId: string): void => {
    sessionsRef.current[chatId]?.stop();
  }, []);

  return { states, stop };
}

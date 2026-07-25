import { useCallback, useEffect, useRef, useState } from "react";
import type {
  IStreamSession,
  StreamConnectionStatus,
} from "@traycer-clients/shared/host-transport/i-stream-session";
import { HOST_BEARER_TOKEN, HOST_USER_ID, HOST_WS_URL } from "@/config";
import {
  applyServerFrame,
  parseChatServerFrame,
  type BlockedItem,
} from "@/host/chat-blocked";
import { approvalDecisionFrame } from "@/host/chat-reply";
import { createChatStream } from "@/host/stream-connection";

export type ChatConnectionStatus = StreamConnectionStatus | "unconfigured";

export interface ChatBlockedState {
  readonly status: ChatConnectionStatus;
  readonly blocked: readonly BlockedItem[];
  /** Approve or reject a pending approval by id. No-op if the socket is down. */
  readonly decide: (approvalId: string, approved: boolean) => void;
}

/**
 * Subscribes to one chat's `chat.subscribe` stream and tracks the items waiting
 * on the user, folding each server frame in live. Real stream only — reports
 * `unconfigured` when the env is absent.
 */
export function useChatBlocked(
  epicId: string,
  chatId: string,
): ChatBlockedState {
  const configured =
    HOST_WS_URL !== null && HOST_BEARER_TOKEN !== null && HOST_USER_ID !== null;
  const [status, setStatus] = useState<ChatConnectionStatus>(
    configured ? "connecting" : "unconfigured",
  );
  const [blocked, setBlocked] = useState<readonly BlockedItem[]>([]);
  const sessionRef = useRef<IStreamSession | null>(null);

  useEffect(() => {
    if (
      HOST_WS_URL === null ||
      HOST_BEARER_TOKEN === null ||
      HOST_USER_ID === null
    ) {
      return;
    }
    setBlocked([]);
    const stream = createChatStream({
      websocketUrl: HOST_WS_URL,
      bearerToken: HOST_BEARER_TOKEN,
      userId: HOST_USER_ID,
    });
    const session = stream.subscribeChat(epicId, chatId);
    sessionRef.current = session;
    session.onStatusChange((next) => {
      setStatus(next);
    });
    session.onServerFrame((envelope) => {
      const frame = parseChatServerFrame(envelope);
      if (frame === null) {
        return;
      }
      setBlocked((prev) => applyServerFrame(prev, frame));
    });
    return () => {
      sessionRef.current = null;
      session.close();
      stream.close("chat view closed");
    };
  }, [epicId, chatId]);

  const decide = useCallback(
    (approvalId: string, approved: boolean) => {
      const session = sessionRef.current;
      if (session === null) {
        return;
      }
      session.sendClientFrame(
        approvalDecisionFrame({ epicId, chatId, approvalId, approved }),
        null,
      );
    },
    [epicId, chatId],
  );

  return { status, blocked, decide };
}

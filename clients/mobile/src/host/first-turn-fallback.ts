/**
 * Send-after-subscribe fallback for a folded first turn.
 *
 * `epic.create` / `epic.createChat` can carry the user's first message as a
 * folded `initialMessage` so the host can schedule the provider turn without an
 * extra round trip. The host reports whether that worked via
 * `initialTurnStarted` — and it is NOT a formality: measured against a real host
 * it comes back **false**, and the protocol's own schema doc says a detached
 * epic-create returns false precisely "so the stream-driven fallback remains
 * armed". gui-app arms that fallback through its initial-chat-handoff store.
 *
 * Without it, "Create epic" produces an epic whose chat holds a persisted user
 * message that nothing is acting on — no turn, no error, just silence. That is
 * the whole first impression of the button, so it is fixed here rather than left
 * as a debt marker.
 *
 * WHY RE-SENDING IS SAFE. The frame reuses the folded message's `messageId`, and
 * the host dedupes `send` on exactly that field — measured, not assumed: see
 * `use-chat.ts`'s `sendMessage` docblock, which records that repeated identical
 * sends ack `accepted` with no new message and no new turn, holding even across
 * a full close+resubscribe. So this is idempotent whether the folded turn
 * started or not, which is what makes an automatic retry defensible instead of a
 * duplicate-turn risk.
 *
 * WHY IT WAITS. `WsStreamClient.sendClientFrame` DROPS frames whenever
 * `phase !== "subscribed"` (stream contracts are fire-and-forget; Y.js absorbs
 * missed deltas — but a `send` is not a delta). So opening a session and
 * immediately writing would silently do nothing. This waits for the session's
 * connection state to reach "live" before writing, then waits for the host's
 * `messageAccepted` ack before reporting success.
 */
import { v4 as uuidv4 } from "uuid";
import { DEFAULT_ACCOUNT_CONTEXT } from "@traycer/protocol/common/schemas";
import type { JsonContent } from "@traycer/protocol/common/registry";
import type { ChatStreamCallbacks } from "@traycer-clients/shared/host-transport/chat-stream-client";
import type { ChatSubscribeClientFrame } from "@traycer/protocol/host/agent/gui/subscribe";
import type { CreateChatInitialMessage } from "@traycer/protocol/host/epic/unary-schemas";
import type { HostStreamConnection } from "@/host/stream-connection";

/**
 * How long to wait for the host's `messageAccepted` before giving up. Generous
 * relative to an RTT: this races a fresh `chat.subscribe`, whose snapshot the
 * host sends first and which is slow on a cold epic (the `earlyMeta` docblock
 * cites ~8-11s; see Gap 2 in the protocol-gaps ticket).
 */
export const FIRST_TURN_ACK_TIMEOUT_MS = 20_000;

export interface FirstTurnHandoff {
  readonly epicId: string;
  readonly chatId: string;
  /** The FOLDED message's ids and payload, reused verbatim so the host dedupes. */
  readonly initialMessage: CreateChatInitialMessage;
}

/**
 * `accepted` — the host acked the send, so a turn is running (or was already).
 * `timeout` — no ack in time; the epic and its message exist, but nothing is
 * acting on it, and the caller must say so rather than implying success.
 * `no-connection` — no stream connection to send over at all.
 */
export type FirstTurnOutcome = "accepted" | "timeout" | "no-connection";

/** Every `ChatStreamCallbacks` member as a no-op except the one this flow reads. */
function ackOnlyCallbacks(
  onMessageAccepted: ChatStreamCallbacks["onMessageAccepted"],
): ChatStreamCallbacks {
  return {
    onMessageAccepted,
    onSnapshot: () => {},
    onActionAck: () => {},
    onQueueChanged: () => {},
    onTurnStateChanged: () => {},
    onBlockDelta: () => {},
    onApprovalRequested: () => {},
    onApprovalResolved: () => {},
    onFileEditApprovalRequested: () => {},
    onFileEditApprovalResolved: () => {},
    onInterviewRequested: () => {},
    onInterviewAnswered: () => {},
    onInterviewErrored: () => {},
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
 * The `send` frame for a folded first turn. Mirrors `use-chat.ts`'s `sendMessage`
 * frame field-for-field, with ONE deliberate difference: `messageId` is the
 * folded message's id rather than a fresh uuid, which is what makes the re-send
 * idempotent.
 */
export function buildFirstTurnSendFrame(
  handoff: FirstTurnHandoff,
  content: JsonContent,
): ChatSubscribeClientFrame {
  return {
    hasBinaryPayload: false,
    epicId: handoff.epicId,
    chatId: handoff.chatId,
    clientActionId: uuidv4(),
    kind: "send",
    messageId: handoff.initialMessage.messageId,
    content,
    sender: handoff.initialMessage.sender,
    settings: handoff.initialMessage.settings,
    accountContext: DEFAULT_ACCOUNT_CONTEXT,
    deliveryPolicy: "auto",
    worktreeIntent: null,
  };
}

/**
 * Opens a short-lived `chat.subscribe` for the just-created chat, re-sends the
 * folded first message once the session is live, and resolves when the host acks
 * it. The session is always closed before resolving — this is a one-shot kick,
 * not a subscription the UI keeps.
 */
export function startFoldedFirstTurn(
  streamConnection: HostStreamConnection | null,
  handoff: FirstTurnHandoff,
  timeoutMs: number,
): Promise<FirstTurnOutcome> {
  if (streamConnection === null) {
    return Promise.resolve("no-connection");
  }
  return new Promise<FirstTurnOutcome>((resolve) => {
    let settled = false;
    let sent = false;
    let unsubscribe: (() => void) | null = null;
    // `window.setTimeout` (not the bare global) so the handle is a plain
    // `number` in this browser build rather than Node's `Timeout` object.
    let timer: number | null = null;

    const handle = streamConnection.openChat({
      epicId: handoff.epicId,
      chatId: handoff.chatId,
      callbacks: ackOnlyCallbacks((frame) => {
        // Only OUR message's ack counts — a racing send from elsewhere in the
        // app must not be mistaken for this turn starting. The id lives on the
        // accepted MESSAGE (`messageAccepted` carries `message`, not a flat
        // `messageId` — checked against the frame schema, not assumed).
        if (frame.message.messageId !== handoff.initialMessage.messageId) return;
        finish("accepted");
      }),
    });

    function finish(outcome: FirstTurnOutcome): void {
      if (settled) return;
      settled = true;
      if (timer !== null) window.clearTimeout(timer);
      if (unsubscribe !== null) unsubscribe();
      handle.stream.close();
      resolve(outcome);
    }

    function sendWhenLive(): void {
      if (sent || settled) return;
      if (handle.connection.getState() !== "live") return;
      sent = true;
      handle.stream.sendAction(
        buildFirstTurnSendFrame(handoff, handoff.initialMessage.content),
      );
    }

    timer = window.setTimeout(() => {
      finish("timeout");
    }, timeoutMs);
    unsubscribe = handle.connection.subscribe(sendWhenLive);
    // A session that is already live emits no transition, so poke it once.
    sendWhenLive();
  });
}

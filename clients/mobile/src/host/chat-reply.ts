// Reply frames sent back into a chat over the `chat.subscribe` stream. These are
// plain `StreamFrameEnvelope`s (the session's sendClientFrame takes the loose
// shape); the chat-reply.test.ts suite validates each against the protocol's own
// `chatSubscribeClientFrameSchema`, so a shape mismatch fails in CI, not on the
// wire.

import type { StreamFrameEnvelope } from "@traycer-clients/shared/host-transport/i-stream-session";
import { v4 as uuidv4 } from "uuid";

export interface ApprovalReply {
  readonly epicId: string;
  readonly chatId: string;
  readonly approvalId: string;
  readonly approved: boolean;
  readonly reason?: string;
}

/**
 * Builds an `approvalDecision` client frame (approve/reject a pending tool or
 * plan approval). The clean first reply target — the approval carries its own
 * description + actions in the snapshot, so no transcript resolution is needed.
 */
export function approvalDecisionFrame(reply: ApprovalReply): StreamFrameEnvelope {
  const decision =
    reply.reason === undefined
      ? { approved: reply.approved }
      : { approved: reply.approved, reason: reply.reason };
  return {
    kind: "approvalDecision",
    hasBinaryPayload: false,
    epicId: reply.epicId,
    chatId: reply.chatId,
    clientActionId: uuidv4(),
    approvalId: reply.approvalId,
    decision,
  };
}

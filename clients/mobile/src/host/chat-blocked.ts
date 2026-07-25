// Narrowing + blocked-state extraction for the `chat.subscribe` stream.
//
// The stream session delivers loosely-typed envelopes; we narrow them to the
// real contract union with the protocol's own Zod schema, then pull out the
// items that need the user: pending approvals (which carry a description +
// actions) and pending interviews (which carry a blockId; the question text
// lives in the transcript block, resolved in a later slice).

import {
  chatSubscribeServerFrameSchema,
  type ChatSnapshot,
  type ChatSubscribeServerFrame,
} from "@traycer/protocol/host/agent/gui/subscribe";
import type { StreamFrameEnvelope } from "@traycer-clients/shared/host-transport/i-stream-session";

/** Narrows a raw stream envelope to the typed `chat.subscribe` frame, or null. */
export function parseChatServerFrame(
  envelope: StreamFrameEnvelope,
): ChatSubscribeServerFrame | null {
  const result = chatSubscribeServerFrameSchema.safeParse(envelope);
  return result.success ? result.data : null;
}

export interface BlockedItem {
  readonly kind: "approval" | "interview";
  /** approvalId for approvals, blockId for interviews. */
  readonly id: string;
  readonly title: string;
}

/**
 * The items in a chat snapshot that are waiting on the user. Accepts just the
 * pending-* slices so callers (and tests) don't need to build a whole snapshot.
 */
export function blockedFromSnapshot(
  snapshot: Pick<ChatSnapshot, "pendingApprovals" | "pendingInterviews">,
): BlockedItem[] {
  const items: BlockedItem[] = [];
  for (const approval of snapshot.pendingApprovals) {
    items.push({
      kind: "approval",
      id: approval.approvalId,
      title: approval.description,
    });
  }
  for (const interview of snapshot.pendingInterviews) {
    items.push({
      kind: "interview",
      id: interview.blockId,
      title: "Awaiting your input",
    });
  }
  return items;
}

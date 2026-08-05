/**
 * "Waiting on you" — the `attention` slice of `host.notifications.feed`.
 *
 * WHY THIS FEED AND NOT `notifications.subscribe`. That one is also
 * user-scoped and also a stream, and it carries COLLABORATION events —
 * invited, role changed, comments, threads. Real and useful, and not the
 * question this screen asks. `host.notifications.feed.subscribe` is the feed
 * the bridge uses to find chats needing attention without polling, and its
 * snapshot has `attention` as a first-class slice with its own cursor.
 *
 * So `attention` is not a projection invented here. The host computes it.
 *
 * NO Y.DOC. These are typed JSON frames, which is why this surface cannot
 * repeat the epic doc's 50.6 MB / 40s problem — there is nothing to serialise
 * and nothing to decode.
 */
import type { HostNotificationEntry } from "@traycer/protocol/host/notifications/host-notifications";

/** One row of the screen: something that needs a human. */
export interface AttentionItem {
  readonly id: string;
  readonly kind: HostNotificationEntry["kind"];
  readonly epicId: string | null;
  readonly chatId: string | null;
  readonly updatedAt: number;
  readonly unread: boolean;
}

/**
 * Which kinds actually WAIT on a person.
 *
 * `agent.stopped`, `agent.stalled` and `workspace.operation.failed` are
 * things that HAPPENED — they belong on a "recent" surface, not on one whose
 * whole promise is "these need you". Including them would make the count
 * wrong in the direction that matters: a badge saying 6 when 2 need action
 * teaches the user to ignore the badge.
 */
const BLOCKING_KINDS: ReadonlySet<string> = new Set([
  "approval.requested",
  "interview.requested",
]);

/**
 * Projects the feed's `attention` entries to rows, dropping anything already
 * resolved or not actually blocking.
 *
 * `resolvedAt` is checked rather than trusted from the slice alone: an entry
 * can be answered from another client between the snapshot and the render,
 * and a resolved approval still listed is the screen asking for something
 * already done.
 */
export function toAttentionItems(
  entries: readonly HostNotificationEntry[],
): readonly AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const entry of entries) {
    if (!BLOCKING_KINDS.has(entry.kind)) continue;
    // Only the two blocking kinds carry `resolvedAt`; the guard above means
    // this narrowing is safe, and reading it defensively costs nothing.
    const resolvedAt =
      "resolvedAt" in entry ? (entry.resolvedAt as number | null) : null;
    if (resolvedAt !== null) continue;
    out.push({
      id: entry.id,
      kind: entry.kind,
      epicId: entry.epicId,
      chatId: entry.chatId,
      updatedAt: entry.updatedAt,
      unread: entry.readAt === null,
    });
  }
  // Oldest first: something waiting three days is more urgent than something
  // waiting three minutes, and a newest-first list buries it. The opposite of
  // the epics list, where recency IS the signal.
  return [...out].sort((a, b) => a.updatedAt - b.updatedAt);
}

/**
 * What the row says it wants.
 *
 * Named per kind rather than a generic "needs attention": approving a tool
 * call and answering an interview question are different actions, and the
 * user decides which to open from this word.
 */
export function attentionLabel(kind: AttentionItem["kind"]): string {
  switch (kind) {
    case "approval.requested":
      return "Waiting for approval";
    case "interview.requested":
      return "Waiting for your answer";
    default:
      // Unreachable while `BLOCKING_KINDS` gates the projection, and kept
      // honest rather than thrown: a new blocking kind added upstream should
      // render as unspecific, never crash the only screen that lists it.
      return "Waiting on you";
  }
}

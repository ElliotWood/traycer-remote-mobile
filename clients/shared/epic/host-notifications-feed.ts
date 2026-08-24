/**
 * The `host.notifications.feed` frame reducer — pure, no React.
 *
 * EXTRACTED from `clients/mobile/src/host/use-host-notifications.ts` when the
 * Teams tab needed the same feed. Moved rather than reimplemented, because
 * the frame handling has three details that are easy to get subtly wrong and
 * whose breakage is invisible:
 *
 *   - `readStateChanged` must NOT spread `resolvedAt` onto every kind. Only
 *     the approval/interview variants carry it, and widening the union there
 *     produces entries that type-check and lie.
 *   - `removedIds` arrives on FOUR different frames, not just `removed`. Miss
 *     one and deleted rows linger on screen.
 *   - `channelEmission` and `pong` are external-delivery and heartbeat
 *     frames. Treating either as feed state would double-count.
 *
 * What stays in each client is the React wrapper: `useState` in mobile's
 * hook, the tab's own. This is the same split as `epic-list` — the protocol
 * in shared, the framework at the edge.
 */
import type {
  HostNotificationEntry,
  HostNotificationsSummary,
  HostNotificationsSubscribeServerFrame,
} from "@traycer/protocol/host/notifications/host-notifications";

export interface FeedState {
  readonly entriesById: Readonly<Record<string, HostNotificationEntry>>;
  readonly summary: HostNotificationsSummary | null;
}

export const EMPTY_FEED_STATE: FeedState = {
  entriesById: {},
  // `null`, NOT a zeroed summary. "We have not been told the counts" and
  // "the counts are zero" are different facts, and a zeroed default would
  // render a confident "nothing waiting" before the snapshot arrives — the
  // empty-versus-loading conflation, on the surface where empty is the
  // headline.
  summary: null,
};

/**
 * Applies one server frame. Pure: same state in, same state out, no I/O.
 *
 * Unknown frame kinds return the state unchanged rather than throwing. A feed
 * that gains a frame type upstream should degrade to not-showing-it, never to
 * taking down the screen that lists what needs a human.
 */
export function applyFeedFrame(
  state: FeedState,
  frame: HostNotificationsSubscribeServerFrame,
): FeedState {
  switch (frame.kind) {
    case "snapshot": {
      const merged: Record<string, HostNotificationEntry> = {};
      for (const entry of [
        ...frame.attention.entries,
        ...frame.recent.entries,
      ]) {
        merged[entry.id] = entry;
      }
      return { entriesById: merged, summary: frame.summary };
    }
    case "upserted": {
      const next = { ...state.entriesById };
      for (const id of frame.removedIds) delete next[id];
      next[frame.entry.id] = frame.entry;
      return { entriesById: next, summary: frame.summary };
    }
    case "readStateChanged": {
      const next = { ...state.entriesById };
      for (const id of frame.removedIds) delete next[id];
      for (const id of frame.ids) {
        const existing = next[id];
        if (existing === undefined) continue;
        // `resolvedAt` exists only on the approval/interview variants.
        // Spreading it onto every kind would widen the union incorrectly and
        // produce entries that pass the type checker while carrying a field
        // their kind does not have.
        next[id] =
          "resolvedAt" in existing
            ? {
                ...existing,
                readAt: frame.readAt,
                resolvedAt: frame.resolvedAt,
              }
            : { ...existing, readAt: frame.readAt };
      }
      return { entriesById: next, summary: frame.summary };
    }
    case "removed":
    case "cleared": {
      const next = { ...state.entriesById };
      for (const id of frame.removedIds) delete next[id];
      return { entriesById: next, summary: frame.summary };
    }
    case "channelEmission":
    case "pong":
      // External delivery (toast / push / webhook) and heartbeat. Neither is
      // feed state; counting them would double-report.
      return state;
    default:
      return state;
  }
}

/** Every entry, as a list. Order is the caller's concern. */
export function feedEntries(
  state: FeedState,
): readonly HostNotificationEntry[] {
  return Object.values(state.entriesById);
}
